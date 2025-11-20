import { POST } from '@/app/api/admin/reset/route';
import { getServerSession } from "next-auth/next";

// Mock dependencies
jest.mock("next-auth/next");
jest.mock("@/lib/firestore", () => ({
    resetDatabase: jest.fn()
}));
jest.mock("@/auth.config", () => ({
    authOptions: {}
}));

describe('Admin Reset API', () => {
    it('returns 401 for non-admin user', async () => {
        getServerSession.mockResolvedValue({
            user: { email: 'hacker@example.com' }
        });

        const request = { json: async () => ({}) };
        const response = await POST(request);
        expect(response.status).toBe(401);
    });

    it('returns 401 for unauthenticated user', async () => {
        getServerSession.mockResolvedValue(null);

        const request = { json: async () => ({}) };
        const response = await POST(request);
        expect(response.status).toBe(401);
    });

    it('returns 200 for admin user', async () => {
        getServerSession.mockResolvedValue({
            user: { email: 'jed.piezas@gmail.com' }
        });

        const request = { json: async () => ({}) };
        const response = await POST(request);
        expect(response.status).toBe(200);
    });
});
