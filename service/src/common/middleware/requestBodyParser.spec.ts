import * as express from 'express';
import { AddressInfo } from 'node:net';
import { registerRequestBodyParsers, resolveRequestBodyLimit } from './requestBodyParser';

declare const describe: any;
declare const expect: any;
declare const it: any;

describe('request body parser configuration', () => {
  it('uses a larger default request body limit for chat payloads', () => {
    expect(resolveRequestBodyLimit()).toBe('20mb');
  });

  it('accepts JSON payloads larger than the Express default 100kb limit', async () => {
    const app = express();
    registerRequestBodyParsers(app, '256kb');
    app.post('/echo', (req, res) => {
      res.json({ length: req.body?.messages?.[0]?.content?.length || 0 });
    });

    const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
      const instance = app.listen(0, () => resolve(instance));
    });

    try {
      const address = server.address() as AddressInfo;
      const content = 'word '.repeat(30_000);
      const response = await fetch(`http://127.0.0.1:${address.port}/echo`, {
        body: JSON.stringify({ messages: [{ content, role: 'user' }] }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ length: content.length });
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
