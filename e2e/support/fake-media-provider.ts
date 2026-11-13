import http from 'node:http';
import type { Socket } from 'node:net';
import { sniffImage } from '../../src/lib/message-media';

/**
 * Loopback stand-in for the Cloudinary upload API, used only by the media E2E spec.
 *
 * Listens on 127.0.0.1:<port> only. A listen error (including "address in use")
 * rejects with a message naming the port; it never retries, reuses or stops another
 * listener. Accepts only POST /v1_1/e2e-sandbox/image/upload; everything else is 404.
 */

export type RecordedUpload = {
    publicId: string;
    authorization: string;
    fileName: string;
    mimeType: string;
    bytes: Buffer;
    fields: Record<string, string>;
};

export type FakeMediaProvider = {
    uploads: Map<string, RecordedUpload>;
    failNext(status: number): void;
    close(): Promise<void>;
};

const UPLOAD_PATH = '/v1_1/e2e-sandbox/image/upload';

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

export async function startFakeMediaProvider({ port }: { port: number }): Promise<FakeMediaProvider> {
    const uploads = new Map<string, RecordedUpload>();
    const sockets = new Set<Socket>();
    let nextFailure: number | null = null;

    const server = http.createServer(async (req, res) => {
        try {
            const path = (req.url || '').split('?')[0];
            if (req.method !== 'POST' || path !== UPLOAD_PATH) {
                sendJson(res, 404, { error: { message: 'not found' } });
                return;
            }

            const buffer = await readBody(req);
            const form = await new Response(buffer, {
                headers: { 'content-type': String(req.headers['content-type'] || '') },
            }).formData();

            if (nextFailure !== null) {
                const status = nextFailure;
                nextFailure = null;
                sendJson(res, status, { error: { message: 'synthetic' } });
                return;
            }

            const fields: Record<string, string> = {};
            form.forEach((value, key) => {
                if (typeof value === 'string') {
                    fields[key] = value;
                }
            });
            const file = form.get('file');
            if (!file || typeof file === 'string') {
                sendJson(res, 400, { error: { message: 'synthetic' } });
                return;
            }
            const bytes = Buffer.from(await file.arrayBuffer());
            const parsed = sniffImage(new Uint8Array(bytes));
            const publicId = fields.public_id || '';
            if (!parsed || !publicId) {
                sendJson(res, 400, { error: { message: 'synthetic' } });
                return;
            }

            uploads.set(publicId, {
                publicId,
                authorization: String(req.headers.authorization || ''),
                fileName: (file as File).name,
                mimeType: file.type,
                bytes,
                fields,
            });

            sendJson(res, 200, {
                public_id: publicId,
                version: 1700000000,
                resource_type: 'image',
                type: 'upload',
                format: parsed.format,
                width: parsed.width,
                height: parsed.height,
                bytes: bytes.length,
            });
        } catch {
            if (!res.headersSent) {
                sendJson(res, 500, { error: { message: 'synthetic' } });
            } else {
                res.end();
            }
        }
    });

    server.on('connection', (socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
    });

    await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
            server.off('listening', onListening);
            reject(new Error(`Fake media provider could not listen on 127.0.0.1:${port}: ${error.message}`));
        };
        const onListening = () => {
            server.off('error', onError);
            resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, '127.0.0.1');
    });

    return {
        uploads,
        failNext(status: number) {
            nextFailure = status;
        },
        close() {
            return new Promise<void>((resolve) => {
                sockets.forEach((socket) => socket.destroy());
                server.close(() => resolve());
            });
        },
    };
}
