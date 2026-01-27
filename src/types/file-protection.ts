import { z } from 'zod';

export const ProtectFilesSchema = z.object({
  operation: z.enum(['delete', 'overwrite', 'move']).describe('Type of file operation'),
  path: z.string().describe('Path to file or directory'),
  target_path: z.string().optional().describe('Destination path (required for move operations)'),
  force: z.boolean().default(false).describe('Force operation (bypasses certain checks)'),
  reason: z.string().optional().describe('Reason for the operation'),
});

export type ProtectFilesInput = z.infer<typeof ProtectFilesSchema>;

export interface FileOperation {
  id: string;
  operation: 'delete' | 'overwrite' | 'move';
  path: string;
  targetPath?: string;
  timestamp: Date;
  status: 'pending' | 'approved' | 'denied' | 'executed' | 'rolled_back';
  reason?: string;
  force: boolean;
  backupPath?: string;
  error?: string;
}

export interface ProtectionViolation {
  type: 'forbidden_path' | 'protected_pattern' | 'dangerous_operation' | 'system_file';
  path: string;
  message: string;
  severity: 'critical' | 'high' | 'medium';
}

export interface OperationLog {
  id: string;
  timestamp: Date;
  operation: string;
  path: string;
  status: string;
  violations?: ProtectionViolation[];
  backupPath?: string;
  userId?: string;
}
