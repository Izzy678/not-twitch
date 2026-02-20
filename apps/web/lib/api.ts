const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';

export interface Stream {
  id: string;
  title: string;
  description?: string;
  streamKey: string;
  isLive: boolean;
  broadcasterId: string;
  viewerCount: number;
  createdAt: string;
  updatedAt: string;
}

export const streamsApi = {
  getAll: async (): Promise<Stream[]> => {
    const res = await fetch(`${API_URL}/streams`);
    if (!res.ok) {
      throw new Error('Failed to fetch streams');
    }
    return res.json();
  },

  getOne: async (id: string): Promise<Stream> => {
    const res = await fetch(`${API_URL}/streams/${id}`);
    if (!res.ok) {
      throw new Error('Failed to fetch stream');
    }
    return res.json();
  },

  create: async (data: {
    title: string;
    description?: string;
    broadcasterId: string;
  }): Promise<Stream> => {
    const res = await fetch(`${API_URL}/streams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      throw new Error('Failed to create stream');
    }
    return res.json();
  },

  update: async (id: string, data: Partial<Stream>): Promise<Stream> => {
    const res = await fetch(`${API_URL}/streams/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      throw new Error('Failed to update stream');
    }
    return res.json();
  },
};
