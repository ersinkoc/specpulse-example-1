const Joi = require('joi');
const { config: securityConfig, utils: securityUtils } = require('../config/security');

// User registration validation schema
const registerSchema = Joi.object({
  email: Joi.string()
    .email()
    .required()
    .messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required'
    }),

  password: Joi.string()
    .min(securityConfig.password.minLength)
    .pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$'))
    .required()
    .messages({
      'string.min': `Password must be at least ${securityConfig.password.minLength} characters long`,
      'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
      'any.required': 'Password is required'
    }),

  confirmPassword: Joi.string()
    .valid(Joi.ref('password'))
    .required()
    .messages({
      'any.only': 'Passwords must match',
      'any.required': 'Password confirmation is required'
    }),

  name: Joi.string()
    .min(1)
    .max(255)
    .trim()
    .required()
    .messages({
      'string.min': 'Name cannot be empty',
      'string.max': 'Name cannot exceed 255 characters',
      'any.required': 'Name is required'
    })
});

// User login validation schema
const loginSchema = Joi.object({
  email: Joi.string()
    .email()
    .required()
    .messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required'
    }),

  password: Joi.string()
    .required()
    .messages({
      'any.required': 'Password is required'
    })
});

// Password reset request validation schema
const passwordResetRequestSchema = Joi.object({
  email: Joi.string()
    .email()
    .required()
    .messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required'
    })
});

// Password reset validation schema
const passwordResetSchema = Joi.object({
  token: Joi.string()
    .length(64) // 32 bytes = 64 hex characters
    .hex()
    .required()
    .messages({
      'string.length': 'Invalid reset token',
      'string.hex': 'Invalid reset token format',
      'any.required': 'Reset token is required'
    }),

  password: Joi.string()
    .min(securityConfig.password.minLength)
    .pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$'))
    .required()
    .messages({
      'string.min': `Password must be at least ${securityConfig.password.minLength} characters long`,
      'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
      'any.required': 'Password is required'
    }),

  confirmPassword: Joi.string()
    .valid(Joi.ref('password'))
    .required()
    .messages({
      'any.only': 'Passwords must match',
      'any.required': 'Password confirmation is required'
    })
});

// Email verification validation schema
const emailVerificationSchema = Joi.object({
  token: Joi.string()
    .length(64) // 32 bytes = 64 hex characters
    .hex()
    .required()
    .messages({
      'string.length': 'Invalid verification token',
      'string.hex': 'Invalid verification token format',
      'any.required': 'Verification token is required'
    })
});

// Profile update validation schema
const profileUpdateSchema = Joi.object({
  name: Joi.string()
    .min(1)
    .max(255)
    .trim()
    .optional()
    .messages({
      'string.min': 'Name cannot be empty',
      'string.max': 'Name cannot exceed 255 characters'
    }),

  avatarUrl: Joi.string()
    .uri()
    .optional()
    .allow('')
    .messages({
      'string.uri': 'Avatar URL must be a valid URL'
    })
}).min(1).messages({
  'object.min': 'At least one field must be provided for update'
});

// Password change validation schema
const passwordChangeSchema = Joi.object({
  currentPassword: Joi.string()
    .required()
    .messages({
      'any.required': 'Current password is required'
    }),

  newPassword: Joi.string()
    .min(securityConfig.password.minLength)
    .pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$'))
    .required()
    .messages({
      'string.min': `Password must be at least ${securityConfig.password.minLength} characters long`,
      'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
      'any.required': 'New password is required'
    }),

  confirmNewPassword: Joi.string()
    .valid(Joi.ref('newPassword'))
    .required()
    .messages({
      'any.only': 'New passwords must match',
      'any.required': 'Password confirmation is required'
    })
});

// Token refresh validation schema
const tokenRefreshSchema = Joi.object({
  refreshToken: Joi.string()
    .required()
    .messages({
      'any.required': 'Refresh token is required'
    })
});

// OAuth2 state validation schema
const oauthStateSchema = Joi.object({
  state: Joi.string()
    .length(64) // 32 bytes = 64 hex characters
    .hex()
    .required()
    .messages({
      'string.length': 'Invalid state parameter',
      'string.hex': 'Invalid state format',
      'any.required': 'State parameter is required'
    }),

  provider: Joi.string()
    .valid('google', 'github')
    .required()
    .messages({
      'any.only': 'Invalid OAuth2 provider',
      'any.required': 'OAuth2 provider is required'
    })
});

// Generic validation middleware
const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    const data = req[source];

    const { error, value } = schema.validate(data, {
      abortEarly: false, // Return all validation errors
      stripUnknown: true, // Remove unknown fields
      convert: true // Convert types automatically
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context.value
      }));

      return res.status(400).json({
        error: 'Validation failed',
        message: 'Please check your input and try again',
        errors
      });
    }

    // Replace the request data with validated and sanitized data
    req[source] = value;
    next();
  };
};

// Validation functions for different scenarios
const validateRegistration = validate(registerSchema);
const validateLogin = validate(loginSchema);
const validatePasswordResetRequest = validate(passwordResetRequestSchema);
const validatePasswordReset = validate(passwordResetSchema);
const validateEmailVerification = validate(emailVerificationSchema);
const validateProfileUpdate = validate(profileUpdateSchema);
const validatePasswordChange = validate(passwordChangeSchema);
const validateTokenRefresh = validate(tokenRefreshSchema);
const validateOAuthState = validate(oauthStateSchema, 'query');

// Custom validation for complex scenarios
const validateUserCreation = async (userData) => {
  const { error, value } = registerSchema.validate(userData);

  if (error) {
    return {
      isValid: false,
      errors: error.details.map(detail => detail.message)
    };
  }

  // Additional business logic validation can be added here
  // For example, checking if email domain is allowed, etc.

  return {
    isValid: true,
    data: value
  };
};

const validatePasswordStrength = (password) => {
  return securityUtils.validatePasswordStrength(password);
};

module.exports = {
  // Schemas
  schemas: {
    register: registerSchema,
    login: loginSchema,
    passwordResetRequest: passwordResetRequestSchema,
    passwordReset: passwordResetSchema,
    emailVerification: emailVerificationSchema,
    profileUpdate: profileUpdateSchema,
    passwordChange: passwordChangeSchema,
    tokenRefresh: tokenRefreshSchema,
    oauthState: oauthStateSchema
  },

  // Middleware functions
  validate,
  validateRegistration,
  validateLogin,
  validatePasswordResetRequest,
  validatePasswordReset,
  validateEmailVerification,
  validateProfileUpdate,
  validatePasswordChange,
  validateTokenRefresh,
  validateOAuthState,

  // Custom validation functions
  validateUserCreation,
  validatePasswordStrength
};