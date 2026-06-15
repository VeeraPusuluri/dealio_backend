import Anthropic from '@anthropic-ai/sdk';
import { Request, Response } from 'express';
import prisma from '../utils/prisma';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildSystemPrompt(role: string, userName?: string, projects?: { name: string; city: string; priceFrom: number | null; priceTo: number | null; status: string }[]): string {
  const fmt = (n: number | null) => {
    if (!n) return '?';
    if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(1)}Cr`;
    if (n >= 100_000)    return `${(n / 100_000).toFixed(0)}L`;
    return `${n.toLocaleString('en-IN')}`;
  };

  const projectLines = projects?.length
    ? projects.slice(0, 12).map(p =>
        `• ${p.name} (${p.city}) — ₹${fmt(p.priceFrom)}–₹${fmt(p.priceTo)}, ${p.status}`
      ).join('\n')
    : 'No projects loaded.';

  const roleGuide: Record<string, string> = {
    builder: `You are assisting a BUILDER (real estate developer). Help with:
- Understanding and using Dealio platform features (projects, leads, CPs, commissions)
- Interpreting pipeline analytics and lead stages
- Managing channel partners and commission structures
- Generating and sharing project brochures
- Understanding RERA compliance requirements`,

    cp: `You are assisting a CHANNEL PARTNER (real estate broker/agent). Help with:
- Drafting warm, personalized WhatsApp messages to clients (include project name, price, key highlights, and a call to action)
- Identifying which Dealio projects match a client's BHK preference, budget, and city
- Understanding commission rates and how earnings are calculated
- Navigating the lead → site visit → booking → registration sales pipeline
- Follow-up strategies and objection handling`,

    customer: `You are assisting a CUSTOMER (home buyer). Guide them through:
- The end-to-end home buying process: shortlisting → site visit → booking → agreement → registration
- EMI and loan eligibility calculations (use standard Indian home loan formulas)
- What RERA registration means and how to verify a project
- Questions to ask a builder before booking
- Understanding carpet area vs super built-up area, parking, maintenance charges`,
  };

  return `You are Dealio AI — a smart real estate assistant built into the Dealio platform.
Dealio is an Indian real estate marketplace connecting Builders, Channel Partners (CPs), and Customers.

${roleGuide[role] ?? 'You are a helpful Dealio platform assistant. Help with any real estate or platform question.'}

Current projects listed on Dealio:
${projectLines}

Rules:
- Keep answers concise and actionable (3–5 sentences per point is ideal)
- Use Indian real estate terminology: lakhs, crores, BHK, carpet area, possession date, RERA
- Format prices as ₹45L or ₹1.2Cr
- When drafting WhatsApp messages, make them warm, personal, and professional
- Never invent project details not listed above; say "I don't have those details right now"
- If asked about EMI, use: EMI = P × r × (1+r)^n / ((1+r)^n − 1) where r = monthly rate, n = months${userName ? `\n\nUser's name: ${userName}` : ''}`;
}

export const aiController = {
  health: (_req: Request, res: Response) => {
    const ready = !!process.env.ANTHROPIC_API_KEY;
    if (!ready) {
      res.status(503).json({ ok: false, message: 'ANTHROPIC_API_KEY not configured' });
      return;
    }
    res.json({ ok: true, message: 'Claude connection ready' });
  },

  chat: async (req: Request, res: Response) => {
    const { messages, context } = req.body as {
      messages: { role: 'user' | 'assistant'; content: string }[];
      context?: { role?: string; userName?: string };
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ ok: false, message: 'messages array required' });
      return;
    }

    // Fetch live project summaries for context
    let projects: { name: string; city: string; priceFrom: number | null; priceTo: number | null; status: string }[] = [];
    try {
      const rows = await prisma.project.findMany({
        select: { name: true, city: true, priceFrom: true, priceTo: true, status: true },
        take: 15,
        orderBy: { createdAt: 'desc' },
        where: { city: { not: null } },
      });
      projects = rows.filter((p): p is typeof p & { city: string } => p.city !== null);
    } catch { /* DB unavailable — continue without project list */ }

    const systemPrompt = buildSystemPrompt(
      context?.role ?? 'customer',
      context?.userName,
      projects,
    );

    // Stream response via SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      const stream = anthropic.messages.stream({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
        }
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'AI error';
      res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
      res.end();
    }
  },
};
