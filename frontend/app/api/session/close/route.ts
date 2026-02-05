/**
 * Session Close API Route - Proxies to Backend
 * Closes an active trading session via the authorized backend relayer
 */

import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { user, pnl = 0 } = body;

        if (!user) {
            return NextResponse.json(
                { error: 'User address is required' },
                { status: 400 }
            );
        }

        const response = await fetch(`${BACKEND_URL}/api/sessions/session/close`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user, pnl }),
        });

        const data = await response.json();
        
        if (!response.ok) {
            return NextResponse.json(data, { status: response.status });
        }

        return NextResponse.json(data);
    } catch (error) {
        console.error('[Session Close] Backend error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to close session' },
            { status: 500 }
        );
    }
}
