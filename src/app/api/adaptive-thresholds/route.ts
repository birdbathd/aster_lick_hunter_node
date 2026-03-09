import { NextResponse } from 'next/server';
import { adaptiveThresholdService } from '@/lib/services/adaptiveThresholdService';

export async function GET() {
  try {
    const status = adaptiveThresholdService.getStatus();
    return NextResponse.json(status);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to get adaptive threshold status' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    if (body.action === 'forceUpdate') {
      await adaptiveThresholdService.forceUpdate();
      const status = adaptiveThresholdService.getStatus();
      return NextResponse.json({ success: true, status });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to perform action' },
      { status: 500 }
    );
  }
}
