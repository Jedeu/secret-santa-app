import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { auth as adminAuth, firestore } from '@/lib/firebase';
import {
    verifyRequestToken,
    assertAdmissibleToken,
    runFencedTransaction,
    admissionErrorResponse,
} from '@/lib/participant-admission';
import { resolveAuthorizedConversationId } from '@/lib/message-utils';
import { yearCollectionPath } from '@/lib/year-paths';
import {
    MEDIA_DAILY_UPLOAD_LIMIT,
    MEDIA_MAX_DIMENSION,
    MEDIA_MAX_UPLOAD_BYTES,
    MEDIA_MIME_TYPES,
    isUuid,
    sniffImage,
} from '@/lib/message-media';
import {
    MEDIA_BODY_READ_TIMEOUT_MS,
    MEDIA_MAX_ATTEMPTS,
    MEDIA_RESERVATION_TTL_MS,
    MEDIA_UPLOADS_COLLECTION,
    MediaError,
    buildPublicId,
    getMediaConfig,
    quotaKeyFor,
    readBodyWithLimit,
    recordToAttachment,
    sha256Hex,
    uploadImageToProvider,
} from '@/lib/media-server';

/**
 * Image attachments: capability probe (GET) and upload (POST).
 *
 * Admin SDK only. The upload authenticates and checks the roster before reading the
 * body, reads it under byte and time bounds, parses the header, hashes the bytes,
 * reserves `mediaUploads/{clientMessageId}` in a fenced transaction, calls the provider
 * outside every transaction, then finalizes (or marks the failure) in a second fenced
 * transaction that writes only while the reservation is still the caller's attempt.
 * Error bodies are { error, code }; provider text is never returned.
 */

export const dynamic = 'force-dynamic';

const USER_ID_HEADER_REGEX = /^[A-Za-z0-9_-]{1,128}$/;
const CONVERSATION_HEADER_REGEX = /^[A-Za-z0-9_-]{1,300}$/;

function errorResponse(status, code, error) {
    return NextResponse.json({ error, code }, { status });
}

function mapError(error, fallbackMessage) {
    if (error?.isMediaError) {
        return errorResponse(error.status, error.code, error.message);
    }
    const mapped = admissionErrorResponse(error);
    if (mapped) return mapped;

    console.error('Media route failed:', { name: error?.name ?? null, code: error?.code ?? null });
    return errorResponse(500, 'INTERNAL', fallbackMessage);
}

function readHeader(request, name) {
    const value = request?.headers?.get?.(name);
    return typeof value === 'string' ? value : '';
}

function normalizeContentType(value) {
    return value.split(';')[0].trim().toLowerCase();
}

function isExpiredReservation(record, nowMs) {
    const updatedMs = Date.parse(record?.updatedAt || '');
    if (Number.isNaN(updatedMs)) return true;
    return nowMs - updatedMs >= MEDIA_RESERVATION_TTL_MS;
}

/**
 * The attempt is still held only when the record exists, belongs to this account and
 * sender, carries the callback's year and epoch and the reservation's year and epoch,
 * is this attempt (mediaId) of the same payload (sha256), and is still `reserved`.
 */
function isReservationHeld(snapshot, { uid, user, year, epoch }, held) {
    if (!snapshot?.exists) return false;
    const record = snapshot.data();
    if (!record) return false;
    if (record.authUid !== uid || record.fromId !== user?.id) return false;
    if (record.year !== year || record.epoch !== epoch) return false;
    if (record.year !== held.year || record.epoch !== held.epoch) return false;
    if (record.mediaId !== held.mediaId || record.sha256 !== held.sha256) return false;
    return record.status === 'reserved';
}

export async function GET(request) {
    try {
        const decoded = await verifyRequestToken(request);
        assertAdmissibleToken(decoded);
        const config = adminAuth && firestore ? getMediaConfig() : null;
        const enabled = !!config;
        return NextResponse.json({ enabled, sandbox: enabled && config.sandbox === true });
    } catch (error) {
        return mapError(error, 'Failed to check image attachments');
    }
}

export async function POST(request) {
    try {
        // 1. Service and configuration (no body read).
        if (!adminAuth || !firestore) {
            return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Media service unavailable');
        }
        const config = getMediaConfig();
        if (!config) {
            return errorResponse(503, 'MEDIA_DISABLED', 'Image attachments are not enabled');
        }

        // 2. Authentication and roster (no body read on failure).
        const decoded = await verifyRequestToken(request);
        assertAdmissibleToken(decoded);

        // 3. Headers.
        const toId = readHeader(request, 'X-Media-To-Id');
        const senderUserId = readHeader(request, 'X-Media-Sender-User-Id');
        const conversationId = readHeader(request, 'X-Media-Conversation-Id');
        const clientMessageId = readHeader(request, 'X-Media-Client-Message-Id');
        if (!USER_ID_HEADER_REGEX.test(toId)
            || !USER_ID_HEADER_REGEX.test(senderUserId)
            || !CONVERSATION_HEADER_REGEX.test(conversationId)
            || !isUuid(clientMessageId)) {
            return errorResponse(400, 'INVALID_REQUEST', 'Invalid upload request');
        }
        const contentType = normalizeContentType(readHeader(request, 'Content-Type'));
        if (!MEDIA_MIME_TYPES.includes(contentType)) {
            return errorResponse(415, 'UNSUPPORTED_MEDIA_TYPE', "That image type isn't supported. Use JPEG, PNG or GIF.");
        }

        // 4. Bounded body read.
        const bytes = await readBodyWithLimit(request, {
            maxBytes: MEDIA_MAX_UPLOAD_BYTES,
            timeoutMs: MEDIA_BODY_READ_TIMEOUT_MS,
        });

        // 5. Header parse (not a validity check; the provider decodes).
        const parsed = sniffImage(bytes);
        if (!parsed || parsed.mimeType !== contentType) {
            return errorResponse(415, 'UNSUPPORTED_MEDIA_TYPE', "That image type isn't supported. Use JPEG, PNG or GIF.");
        }
        if (parsed.width > MEDIA_MAX_DIMENSION || parsed.height > MEDIA_MAX_DIMENSION) {
            return errorResponse(400, 'MEDIA_DIMENSIONS', 'The image dimensions are too large.');
        }

        // 6. Fixed before any transaction so retried callbacks reuse them.
        const sha256 = sha256Hex(bytes);
        const mediaId = uuidv4();
        const mediaRef = firestore.collection(MEDIA_UPLOADS_COLLECTION).doc(clientMessageId);

        // 7. Reservation (fenced on the open year; all reads precede writes).
        const reserve = async (tx, { user: sender, year, epoch, uid }) => {
            const recipientRef = firestore.collection(yearCollectionPath(year, 'users').join('/')).doc(toId);
            const messageRef = firestore.collection(yearCollectionPath(year, 'messages').join('/')).doc(clientMessageId);
            const [recipientSnap, messageSnap, mediaSnap] = await tx.getAll(recipientRef, messageRef, mediaRef);

            if (senderUserId !== sender.id) {
                throw new MediaError(403, 'SENDER_MISMATCH', 'Sender does not match the signed-in account');
            }
            if (messageSnap.exists) {
                throw new MediaError(409, 'MESSAGE_ALREADY_SENT', 'This message has already been sent');
            }
            if (!recipientSnap.exists) {
                throw new MediaError(400, 'RECIPIENT_NOT_FOUND', 'Recipient not found');
            }

            const recipientData = recipientSnap.data() || {};
            const recipient = { ...recipientData, id: recipientData.id ?? recipientSnap.id };
            const resolved = resolveAuthorizedConversationId(sender, recipient, conversationId);
            if (resolved.error) {
                throw new MediaError(400, resolved.error, 'Invalid conversation for this recipient');
            }

            const now = new Date();
            const nowIso = now.toISOString();

            if (mediaSnap.exists) {
                const record = mediaSnap.data() || {};
                const conflicts = record.authUid !== uid
                    || record.fromId !== sender.id
                    || record.toId !== toId
                    || record.conversationId !== resolved.conversationId
                    || record.year !== year
                    || record.epoch !== epoch
                    || record.sha256 !== sha256;
                if (conflicts) {
                    throw new MediaError(409, 'MEDIA_ID_CONFLICT', 'This message id is already used by a different upload');
                }
                if (record.status === 'uploaded' || record.status === 'attached') {
                    return { kind: 'existing', record, year, epoch };
                }
                if (record.status === 'reserved' && !isExpiredReservation(record, now.getTime())) {
                    throw new MediaError(409, 'UPLOAD_IN_PROGRESS', 'This image is still uploading');
                }
                const attempts = Number.isInteger(record.attempts) ? record.attempts : MEDIA_MAX_ATTEMPTS;
                if (attempts >= MEDIA_MAX_ATTEMPTS) {
                    throw new MediaError(409, 'UPLOAD_ATTEMPTS_EXCEEDED', 'Too many upload attempts for this message');
                }

                const staleProviderIds = Array.isArray(record.staleProviderIds) ? record.staleProviderIds : [];
                const takeover = {
                    ...record,
                    mediaId,
                    status: 'reserved',
                    attempts: attempts + 1,
                    provider: 'cloudinary',
                    cloudName: config.cloudName,
                    publicId: buildPublicId(year, mediaId),
                    staleProviderIds: typeof record.publicId === 'string' && record.publicId
                        ? [...staleProviderIds, record.publicId]
                        : [...staleProviderIds],
                    format: parsed.format,
                    width: parsed.width,
                    height: parsed.height,
                    bytes: bytes.length,
                    version: null,
                    updatedAt: nowIso,
                    uploadedAt: null,
                    attachedAt: null,
                };
                tx.set(mediaRef, takeover);
                return { kind: 'reserved', record: takeover, year, epoch };
            }

            const quotaKey = quotaKeyFor(uid, now);
            const quota = await tx.get(
                firestore.collection(MEDIA_UPLOADS_COLLECTION)
                    .where('quotaKey', '==', quotaKey)
                    .limit(MEDIA_DAILY_UPLOAD_LIMIT)
            );
            const used = typeof quota?.size === 'number' ? quota.size : (quota?.docs?.length ?? 0);
            if (used >= MEDIA_DAILY_UPLOAD_LIMIT) {
                throw new MediaError(429, 'MEDIA_QUOTA_EXCEEDED', "You've reached today's image upload limit");
            }

            const record = {
                id: clientMessageId,
                mediaId,
                status: 'reserved',
                attempts: 1,
                authUid: uid,
                fromId: sender.id,
                toId,
                conversationId: resolved.conversationId,
                year,
                epoch,
                quotaKey,
                sha256,
                provider: 'cloudinary',
                cloudName: config.cloudName,
                publicId: buildPublicId(year, mediaId),
                staleProviderIds: [],
                format: parsed.format,
                width: parsed.width,
                height: parsed.height,
                bytes: bytes.length,
                version: null,
                createdAt: nowIso,
                updatedAt: nowIso,
                uploadedAt: null,
                attachedAt: null,
            };
            tx.create(mediaRef, record);
            return { kind: 'reserved', record, year, epoch };
        };

        const reservation = await runFencedTransaction(decoded, reserve);

        if (reservation.kind === 'existing') {
            const existing = recordToAttachment(reservation.record);
            if (!existing) {
                throw new MediaError(500, 'INTERNAL', 'Failed to upload image');
            }
            return NextResponse.json({ success: true, attachment: existing, replayed: true });
        }

        const held = {
            mediaId: reservation.record.mediaId,
            sha256,
            year: reservation.year,
            epoch: reservation.epoch,
        };

        // 8. Provider call, outside every transaction.
        let uploaded;
        try {
            uploaded = await uploadImageToProvider({
                config,
                bytes,
                mimeType: contentType,
                publicId: reservation.record.publicId,
            });
        } catch (providerError) {
            // 9. Fenced failure mark; writes only while the reservation is still held.
            try {
                await runFencedTransaction(decoded, async (tx, context) => {
                    const snapshot = await tx.get(mediaRef);
                    if (!isReservationHeld(snapshot, context, held)) {
                        return { marked: false };
                    }
                    tx.update(mediaRef, { status: 'failed', updatedAt: new Date().toISOString() });
                    return { marked: true };
                });
            } catch {
                // Swallowed: the response is always the original provider error.
            }
            throw providerError;
        }

        // 10. Finalize (fenced); refuses when the reservation is no longer held.
        const finalized = await runFencedTransaction(decoded, async (tx, context) => {
            const snapshot = await tx.get(mediaRef);
            if (!isReservationHeld(snapshot, context, held)) {
                throw new MediaError(409, 'UPLOAD_STALE', 'This upload is no longer current. Try again.');
            }
            const nowIso = new Date().toISOString();
            const update = {
                status: 'uploaded',
                version: uploaded.version,
                width: uploaded.width,
                height: uploaded.height,
                bytes: uploaded.bytes,
                uploadedAt: nowIso,
                updatedAt: nowIso,
            };
            tx.update(mediaRef, update);
            return { ...snapshot.data(), ...update };
        });

        // 11. Server-built attachment.
        const attachment = recordToAttachment(finalized);
        if (!attachment) {
            throw new MediaError(500, 'INTERNAL', 'Failed to upload image');
        }
        return NextResponse.json({ success: true, attachment });
    } catch (error) {
        return mapError(error, 'Failed to upload image');
    }
}
