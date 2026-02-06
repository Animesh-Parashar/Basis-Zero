/**
 * Sessions Router - API Routes for Session Management (Testing Only)
 * Note: This is separate from the Yellow Network session service
 */

import { Router } from 'express';
import * as db from '../db/amm-repository';

export const sessionsRouter = Router();

// Get all sessions
sessionsRouter.get('/', async (req, res) => {
    try {
        const { getSupabase } = await import('../db/supabase.js');
        const supabase = getSupabase();

        const { data, error } = await supabase
            .from('sessions')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw new Error(`Failed to get sessions: ${error.message}`);

        res.json({ sessions: data || [] });
    } catch (err) {
        console.error('[Sessions] Error:', err);
        res.status(500).json({ error: String(err), sessions: [] });
    }
});

// Get a single session
sessionsRouter.get('/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = await db.getSession(sessionId);

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        res.json({ session });
    } catch (err) {
        console.error('[Session Get] Error:', err);
        res.status(500).json({ error: String(err) });
    }
});

// Create a session (for testing)
sessionsRouter.post('/create', async (req, res) => {
    try {
        const { sessionId, userAddress, initialCollateral, signature } = req.body;

        if (!sessionId || !userAddress || !initialCollateral) {
            return res.status(400).json({ 
                error: 'Missing required fields: sessionId, userAddress, initialCollateral' 
            });
        }

        const session = await db.createSession(
            sessionId,
            userAddress,
            BigInt(initialCollateral),
            signature || 'test-signature'
        );

        res.json({ success: true, session });
    } catch (err) {
        console.error('[Session Create] Error:', err);
        res.status(500).json({ error: String(err) });
    }
});

// Update session balance (for testing)
sessionsRouter.post('/:sessionId/update-balance', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { newBalance, signature, nonce } = req.body;

        if (!newBalance || signature === undefined || nonce === undefined) {
            return res.status(400).json({ 
                error: 'Missing required fields: newBalance, signature, nonce' 
            });
        }

        await db.updateSessionBalance(
            sessionId,
            BigInt(newBalance),
            signature,
            nonce
        );

        res.json({ success: true });
    } catch (err) {
        console.error('[Session Update] Error:', err);
        res.status(500).json({ error: String(err) });
    }
});

// Get session by user address
sessionsRouter.get('/user/:address', async (req, res) => {
    try {
        const { address } = req.params;
        const session = await db.getSessionByUser(address);

        if (!session) {
            return res.status(404).json({ error: 'No active session found for user' });
        }

        res.json({ session });
    } catch (err) {
        console.error('[Session by User] Error:', err);
        res.status(500).json({ error: String(err) });
    }
});

// Close a session (for testing)
sessionsRouter.post('/:sessionId/close', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { getSupabase } = await import('../db/supabase.js');
        const supabase = getSupabase();

        const { error } = await supabase
            .from('sessions')
            .update({ status: 'CLOSED' })
            .eq('session_id', sessionId);

        if (error) throw new Error(`Failed to close session: ${error.message}`);

        res.json({ success: true });
    } catch (err) {
        console.error('[Session Close] Error:', err);
        res.status(500).json({ error: String(err) });
    }
});

export default sessionsRouter;
