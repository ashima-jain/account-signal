import type { Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import type { Account } from '../../src/types';

const store = getStore({ name: 'accounts' });

function getIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/\.netlify\/functions\/accounts\/(.*)$/);
  return match?.[1] ?? null;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export default async (req: Request, _context: Context) => {
  const pathname = new URL(req.url).pathname;
  const id = getIdFromPath(pathname);

  const headers = { 'Content-Type': 'application/json' };

  try {
    if (req.method === 'GET' && !id) {
      // List all accounts
      const { blobs } = await store.list();
      const accounts: Account[] = [];
      for (const key of blobs.map(b => b.key)) {
        const data = await store.get(key, { type: 'json' });
        if (data) accounts.push(data as Account);
      }
      accounts.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      return new Response(JSON.stringify(accounts), { status: 200, headers });
    }

    if (req.method === 'GET' && id) {
      const data = await store.get(id, { type: 'json' });
      if (!data) {
        return new Response(JSON.stringify({ error: 'Account not found' }), { status: 404, headers });
      }
      return new Response(JSON.stringify(data), { status: 200, headers });
    }

    if (req.method === 'POST' && !id) {
      const body = await req.json();
      const now = new Date().toISOString();
      const account: Account = {
        id: generateId(),
        companyName: body.companyName || '',
        targetName: body.targetName || '',
        targetTitle: body.targetTitle || '',
        researchNotes: body.researchNotes || '',
        people: body.people || [],
        research: body.research || undefined,
        createdAt: now,
        updatedAt: now,
      };
      await store.setJSON(account.id, account);
      return new Response(JSON.stringify(account), { status: 201, headers });
    }

    if (req.method === 'PUT' && id) {
      const existing = await store.get(id, { type: 'json' });
      if (!existing) {
        return new Response(JSON.stringify({ error: 'Account not found' }), { status: 404, headers });
      }
      const body = await req.json();
      const account: Account = {
        ...(existing as Account),
        ...body,
        id, // prevent id change
        updatedAt: new Date().toISOString(),
      };
      await store.setJSON(id, account);
      return new Response(JSON.stringify(account), { status: 200, headers });
    }

    if (req.method === 'DELETE' && id) {
      await store.delete(id);
      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), { status: 500, headers });
  }
};
