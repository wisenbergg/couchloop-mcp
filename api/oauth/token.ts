import type { VercelRequest, VercelResponse } from '@vercel/node';
import { SignJWT, jwtVerify } from 'jose';
import { nanoid } from 'nanoid';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'default-secret-min-32-characters-long');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    grant_type,
    code,
    redirect_uri,
    client_id,
    client_secret,
    refresh_token,
  } = req.body;

  // Validate client credentials
  if (client_id !== process.env.OAUTH_CLIENT_ID || client_secret !== process.env.OAUTH_CLIENT_SECRET) {
    return res.status(401).json({ error: 'Invalid client credentials' });
  }

  try {
    if (grant_type === 'authorization_code') {
      // TODO: Validate authorization code from database
      // For now, accept any code starting with "code_"
      if (!code || !code.startsWith('code_')) {
        return res.status(400).json({ error: 'Invalid authorization code' });
      }

      // Generate tokens
      const accessToken = await new SignJWT({
        sub: `user_${nanoid()}`,
        client_id,
        scope: 'read write',
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(JWT_SECRET);

      const refreshToken = await new SignJWT({
        sub: `user_${nanoid()}`,
        client_id,
        type: 'refresh',
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('30d')
        .sign(JWT_SECRET);

      return res.status(200).json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: refreshToken,
        scope: 'read write',
      });

    } else if (grant_type === 'refresh_token') {
      if (!refresh_token) {
        return res.status(400).json({ error: 'Refresh token required' });
      }

      // Verify refresh token
      const { payload } = await jwtVerify(refresh_token, JWT_SECRET);

      // Generate new access token
      const accessToken = await new SignJWT({
        sub: payload.sub,
        client_id,
        scope: 'read write',
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(JWT_SECRET);

      return res.status(200).json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'read write',
      });

    } else {
      return res.status(400).json({ error: 'Unsupported grant type' });
    }
  } catch (error) {
    console.error('Token generation error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}