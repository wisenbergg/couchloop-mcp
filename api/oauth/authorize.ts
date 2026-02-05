import type { VercelRequest, VercelResponse } from '@vercel/node';
import { nanoid } from 'nanoid';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    client_id,
    redirect_uri,
    response_type,
    // scope - TODO: validate and use scope in token generation
    state,
  } = req.query;

  // Validate required parameters
  if (!client_id || !redirect_uri || response_type !== 'code') {
    return res.status(400).json({ error: 'Invalid request parameters' });
  }

  // Validate client_id
  if (client_id !== process.env.OAUTH_CLIENT_ID) {
    return res.status(401).json({ error: 'Invalid client_id' });
  }

  // TODO: Implement actual user authentication
  // For now, generate a mock authorization code
  const authCode = `code_${nanoid()}`;

  // In production, this would:
  // 1. Show a login/consent page
  // 2. Validate user credentials
  // 3. Store the auth code in database with expiration
  // 4. Redirect back with the code

  // Redirect back to the client with the authorization code
  const redirectUrl = new URL(redirect_uri as string);
  redirectUrl.searchParams.append('code', authCode);
  if (state) {
    redirectUrl.searchParams.append('state', state as string);
  }

  return res.redirect(302, redirectUrl.toString());
}