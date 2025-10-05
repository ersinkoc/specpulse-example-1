const { z } = require('zod');

// Registration validation schema
const registerSchema = z.object({
  email: z.string()
    .email('Invalid email address')
    .min(1, 'Email is required')
    .max(255, 'Email is too long'),

  password: z.string()
    .min(8, 'Password must be at least 8 characters long')
    .max(128, 'Password is too long'),

  name: z.string()
    .min(1, 'Name is required')
    .max(100, 'Name is too long')
    .regex(/^[a-zA-Z\s'-]+$/, 'Name can only contain letters, spaces, hyphens, and apostrophes'),

  confirmPassword: z.string()
    .min(1, 'Password confirmation is required')
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"]
});

// Login validation schema
const loginSchema = z.object({
  email: z.string()
    .email('Invalid email address')
    .min(1, 'Email is required'),

  password: z.string()
    .min(1, 'Password is required')
});

// Password change validation schema
const changePasswordSchema = z.object({
  currentPassword: z.string()
    .min(1, 'Current password is required'),

  newPassword: z.string()
    .min(8, 'New password must be at least 8 characters long')
    .max(128, 'New password is too long'),

  confirmPassword: z.string()
    .min(1, 'Password confirmation is required')
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"]
});

// Password reset request validation schema
const requestPasswordResetSchema = z.object({
  email: z.string()
    .email('Invalid email address')
    .min(1, 'Email is required')
});

// Password reset validation schema
const resetPasswordSchema = z.object({
  token: z.string()
    .min(1, 'Reset token is required'),

  newPassword: z.string()
    .min(8, 'New password must be at least 8 characters long')
    .max(128, 'New password is too long'),

  confirmPassword: z.string()
    .min(1, 'Password confirmation is required')
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"]
});

// Email verification schema
const verifyEmailSchema = z.object({
  token: z.string()
    .min(1, 'Verification token is required')
});

// Profile update validation schema
const updateProfileSchema = z.object({
  name: z.string()
    .min(1, 'Name cannot be empty')
    .max(100, 'Name is too long')
    .regex(/^[a-zA-Z\s'-]+$/, 'Name can only contain letters, spaces, hyphens, and apostrophes')
    .optional(),

  avatar_url: z.string()
    .url('Invalid avatar URL')
    .optional()
    .or(z.literal('')),

  bio: z.string()
    .max(500, 'Bio is too long')
    .optional()
    .or(z.literal(''))
});

// Preferences update validation schema
const updatePreferencesSchema = z.object({
  preferences: z.object({
    theme: z.enum(['light', 'dark', 'auto']).optional(),
    language: z.string().min(2).max(5).optional(),
    notifications: z.object({
      email: z.boolean().optional(),
      push: z.boolean().optional(),
      security: z.boolean().optional()
    }).optional(),
    privacy: z.object({
      showEmail: z.boolean().optional(),
      showProfile: z.boolean().optional()
    }).optional()
  })
});

// Account deletion validation schema
const deleteAccountSchema = z.object({
  password: z.string()
    .min(1, 'Password is required'),

  confirmation: z.string()
    .refine((data) => data === 'DELETE', {
      message: "Please type 'DELETE' to confirm account deletion"
    })
});

// Session revocation schema
const revokeSessionSchema = z.object({
  sessionId: z.string()
    .uuid('Invalid session ID')
    .min(1, 'Session ID is required')
});

// User ID parameter validation schema
const userIdParamSchema = z.object({
  userId: z.string()
    .uuid('Invalid user ID')
    .min(1, 'User ID is required')
});

// OAuth state validation schema
const oauthStateSchema = z.object({
  state: z.string()
    .min(1, 'OAuth state is required'),

  code: z.string()
    .optional(),

  error: z.string()
    .optional()
});

// Query parameter schemas
const paginationSchema = z.object({
  page: z.string()
    .regex(/^\d+$/, 'Page must be a positive integer')
    .transform(Number)
    .default('1'),

  limit: z.string()
    .regex(/^\d+$/, 'Limit must be a positive integer')
    .transform(Number)
    .default('10'),

  sortBy: z.string()
    .optional(),

  sortOrder: z.enum(['asc', 'desc'])
    .default('desc')
});

// Search query schema
const searchSchema = z.object({
  q: z.string()
    .min(1, 'Search query is required')
    .max(100, 'Search query is too long'),

  page: z.string()
    .regex(/^\d+$/, 'Page must be a positive integer')
    .transform(Number)
    .default('1'),

  limit: z.string()
    .regex(/^\d+$/, 'Limit must be a positive integer')
    .transform(Number)
    .default('10')
});

module.exports = {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  updateProfileSchema,
  updatePreferencesSchema,
  deleteAccountSchema,
  revokeSessionSchema,
  userIdParamSchema,
  oauthStateSchema,
  paginationSchema,
  searchSchema
};