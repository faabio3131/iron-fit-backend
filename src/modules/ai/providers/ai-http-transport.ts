import { Injectable } from '@nestjs/common';
import * as https from 'node:https';
import { lookup } from 'node:dns';
import { AI_MAX_RESPONSE_BYTES, isPublicAiAddress } from './ai-provider-security';

export class AiHttpResponseError extends Error {
  constructor() { super('AI_RESPONSE_INVALID'); }
}

export interface AiHttpResponse { status: number; body: string; }

@Injectable()
export class AiHttpTransport {
  post(url: URL, headers: Record<string, string>, body: string, signal?: AbortSignal): Promise<AiHttpResponse> {
    return this.request('POST', url, headers, body, signal);
  }

  get(url: URL, headers: Record<string, string>, signal?: AbortSignal): Promise<AiHttpResponse> {
    return this.request('GET', url, headers, '', signal);
  }

  private request(method: 'GET' | 'POST', url: URL, headers: Record<string, string>, body: string, signal?: AbortSignal): Promise<AiHttpResponse> {
    return new Promise((resolve, reject) => {
      const request = https.request(url, {
        method, headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
        signal,
        // No pooled sockets can bypass DNS validation; no redirects are followed.
        agent: false,
        lookup: ((hostname: string, options: any, callback: any) => {
          lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
            if (error || !addresses.length || addresses.some((entry) => !isPublicAiAddress(entry.address))) {
              callback(new Error('AI_DNS_EGRESS_DENIED'));
              return;
            }
            if (options?.all) callback(null, addresses);
            else callback(null, addresses[0].address, addresses[0].family);
          });
        }) as typeof lookup,
      }, (response) => {
        const status = response.statusCode ?? 502;
        // Never buffer/log error bodies or follow credential-bearing redirects.
        if (status < 200 || status >= 300) {
          response.destroy();
          resolve({ status, body: '' });
          return;
        }
        if (Number(response.headers['content-length']) > AI_MAX_RESPONSE_BYTES) {
          reject(new AiHttpResponseError());
          response.destroy();
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > AI_MAX_RESPONSE_BYTES) { reject(new AiHttpResponseError()); response.destroy(); }
          else chunks.push(chunk);
        });
        response.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') }));
        response.on('error', () => reject(new AiHttpResponseError()));
      });
      request.on('error', () => reject(new Error(signal?.aborted ? 'AI_REQUEST_ABORTED' : 'AI_TRANSPORT_FAILED')));
      request.end(body);
    });
  }
}
