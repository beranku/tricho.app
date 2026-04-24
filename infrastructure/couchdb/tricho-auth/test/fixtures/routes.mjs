// Lightweight harness that mounts routes.mjs's createRouter with a
// fakeMeta + testSigner and returns a `req()` helper that fires
// request/response round-trips against the router without actually
// starting an HTTP server.

import { PassThrough } from 'node:stream';
import { createRouter } from '../../routes.mjs';

export function mountRouter({ env = {}, meta, signer } = {}) {
  const router = createRouter({ meta, signer, env });

  async function req(method, path, { headers = {}, body = null, cookies = {} } = {}) {
    const reqStream = new PassThrough();
    reqStream.method = method;
    reqStream.url = path;
    const cookieHeader = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    reqStream.headers = {
      host: 'tricho.test',
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
      ...headers,
    };

    const chunks = [];
    const resStream = new PassThrough();
    const res = {
      statusCode: 0,
      headers: {},
      body: Buffer.alloc(0),
      _resolved: false,
      writeHead(code, hdrs) {
        this.statusCode = code;
        this.headers = { ...this.headers, ...hdrs };
      },
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      end(data) {
        if (data) chunks.push(Buffer.from(data));
        this.body = Buffer.concat(chunks);
        this._resolved = true;
        resStream.end();
      },
      write(chunk) { chunks.push(Buffer.from(chunk)); },
    };

    const done = new Promise((resolve) => {
      resStream.on('finish', () => resolve());
      resStream.on('close', () => resolve());
    });

    // Pipe body into the request stream then end it.
    if (body) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      reqStream.end(payload);
    } else {
      reqStream.end();
    }

    await router(reqStream, res);
    if (!res._resolved) await done;
    return {
      status: res.statusCode,
      headers: res.headers,
      body: res.body.toString('utf8'),
      json: () => JSON.parse(res.body.toString('utf8')),
      setCookies: (() => {
        const raw = res.headers['set-cookie'];
        if (!raw) return [];
        return Array.isArray(raw) ? raw : [raw];
      })(),
    };
  }

  return { router, req };
}
