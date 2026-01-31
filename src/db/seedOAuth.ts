#!/usr/bin/env node
import { config } from 'dotenv';
import bcrypt from 'bcryptjs';
import { initDatabase, getDb } from './client.js';
import { oauthClients } from './schema.js';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger.js';

// Load environment variables
config({ path: '.env.local' });

async function seedOAuthClient() {
  try {
    logger.info('Starting OAuth client seed...');

    // Initialize database
    await initDatabase();
    const db = getDb();

    // Require client secret from environment
    const clientSecret = process.env.OAUTH_CLIENT_SECRET;
    if (!clientSecret) {
      throw new Error('OAUTH_CLIENT_SECRET environment variable is required');
    }

    // Hash the client secret
    const hashedSecret = await bcrypt.hash(clientSecret, 10);

    // Insert ChatGPT OAuth client
    const clientData = {
      clientId: process.env.OAUTH_CLIENT_ID || 'couchloop_chatgpt',
      clientSecret: hashedSecret,
      name: 'CouchLoop ChatGPT Plugin',
      redirectUris: [
        process.env.OAUTH_REDIRECT_URI || 'https://chat.openai.com/aip/plugin/oauth/callback',
        'http://localhost:3000/callback', // For local testing
      ],
      grantTypes: ['authorization_code', 'refresh_token'],
      scopes: ['read', 'write', 'crisis', 'memory'],
    };

    // Check if client already exists
    const [existingClient] = await db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.clientId, clientData.clientId))
      .limit(1);

    if (existingClient) {
      // Update existing client
      await db
        .update(oauthClients)
        .set({
          clientSecret: hashedSecret,
          redirectUris: clientData.redirectUris,
          grantTypes: clientData.grantTypes,
          scopes: clientData.scopes,
        })
        .where(eq(oauthClients.clientId, clientData.clientId));

      logger.info(`✓ Updated OAuth client: ${clientData.name}`);
    } else {
      // Insert new client
      await db.insert(oauthClients).values(clientData);
      logger.info(`✓ Created OAuth client: ${clientData.name}`);
    }

    logger.info('OAuth client seed completed successfully!');
    logger.info('');
    logger.info('OAuth Client Details:');
    logger.info(`  Client ID: ${clientData.clientId}`);
    logger.info(`  Client Secret: ${clientSecret}`);
    logger.info(`  Redirect URIs: ${clientData.redirectUris.join(', ')}`);
    logger.info('');
    logger.info('⚠️  IMPORTANT: Save the client secret securely. It cannot be retrieved later.');

    process.exit(0);
  } catch (error) {
    logger.error('OAuth client seed failed:', error);
    process.exit(1);
  }
}

// Run the seed if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedOAuthClient();
}

export { seedOAuthClient };