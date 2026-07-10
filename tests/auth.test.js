const request = require('supertest');

// Mock archiver since it's an ESM module that Jest struggles with natively without extra config
jest.mock('archiver', () => jest.fn());

const app = require('../server');

describe('Auth and Access Control', () => {
    describe('Access Control Middleware', () => {
        it('should block unauthenticated access to GET /api/folders', async () => {
            const res = await request(app).get('/api/folders');
            expect(res.statusCode).toBe(401);
            expect(res.body.error).toBe('Unauthorized: Missing token');
        });

        it('should block unauthenticated access to POST /api/folders', async () => {
            const res = await request(app).post('/api/folders');
            expect(res.statusCode).toBe(401);
            expect(res.body.error).toBe('Unauthorized: Missing token');
        });

        it('should block unauthenticated access to GET /api/settings', async () => {
            const res = await request(app).get('/api/settings');
            expect(res.statusCode).toBe(401);
            expect(res.body.error).toBe('Unauthorized: Missing token');
        });
        
        it('should block unauthenticated access to POST /api/system/restart', async () => {
            const res = await request(app).post('/api/system/restart');
            expect(res.statusCode).toBe(401);
            expect(res.body.error).toBe('Unauthorized: Missing token');
        });
    });

    describe('Login and Logout Endpoints', () => {
        it('should reject login with missing payload', async () => {
            const res = await request(app)
                .post('/api/login')
                .send({});
            
            expect(res.statusCode).toBeGreaterThanOrEqual(400);
        });

        it('should reject login with incorrect password', async () => {
            const res = await request(app)
                .post('/api/login')
                .send({ password: 'thisisawrongpassword' });
            
            expect(res.statusCode).toBe(401);
        });

        it('should block logout if user is not authenticated', async () => {
            const res = await request(app)
                .post('/api/logout');
            
            expect(res.statusCode).toBe(401);
        });
    });
});
