const logger = require('../../shared/utils/logger');

/**
 * Role-Based Access Control (RBAC) Utilities
 */

// Role hierarchy - higher numbers have more privileges
const ROLE_HIERARCHY = {
  'user': 1,
  'moderator': 2,
  'admin': 3,
  'super_admin': 4
};

/**
 * Check if user has sufficient role level
 */
const hasRoleLevel = (userRoles, requiredLevel) => {
  const maxUserRole = Math.max(...userRoles.map(role => ROLE_HIERARCHY[role] || 0));
  return maxUserRole >= requiredLevel;
};

/**
 * Check if user has specific role
 */
const hasRole = (userRoles, role) => {
  return userRoles.includes(role);
};

/**
 * Check if user has any of the specified roles
 */
const hasAnyRole = (userRoles, roles) => {
  return roles.some(role => userRoles.includes(role));
};

/**
 * Check if user has all of the specified roles
 */
const hasAllRoles = (userRoles, roles) => {
  return roles.every(role => userRoles.includes(role));
};

/**
 * Middleware factory for role-based authorization
 */
const requireRole = (role) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'AuthenticationRequired',
        message: 'Authentication required to access this resource'
      });
    }

    const userRoles = req.user.roles || [];

    if (!hasRole(userRoles, role)) {
      logger.warn('Access denied: insufficient role', {
        userId: req.user.id,
        userRoles,
        requiredRole: role,
        path: req.path,
        method: req.method,
        ip: req.ip
      });

      return res.status(403).json({
        success: false,
        error: 'InsufficientPermissions',
        message: `Access denied. Required role: ${role}`,
        userRoles
      });
    }

    logger.debug('Role-based access granted', {
      userId: req.user.id,
      requiredRole: role,
      path: req.path,
      method: req.method
    });

    next();
  };
};

/**
 * Middleware factory for multiple role options
 */
const requireAnyRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'AuthenticationRequired',
        message: 'Authentication required to access this resource'
      });
    }

    const userRoles = req.user.roles || [];

    if (!hasAnyRole(userRoles, roles)) {
      logger.warn('Access denied: insufficient roles', {
        userId: req.user.id,
        userRoles,
        requiredRoles: roles,
        path: req.path,
        method: req.method,
        ip: req.ip
      });

      return res.status(403).json({
        success: false,
        error: 'InsufficientPermissions',
        message: `Access denied. Required one of these roles: ${roles.join(', ')}`,
        userRoles
      });
    }

    logger.debug('Multi-role access granted', {
      userId: req.user.id,
      requiredRoles: roles,
      path: req.path,
      method: req.method
    });

    next();
  };
};

/**
 * Middleware factory for minimum role level
 */
const requireMinRoleLevel = (minLevel) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'AuthenticationRequired',
        message: 'Authentication required to access this resource'
      });
    }

    const userRoles = req.user.roles || [];

    if (!hasRoleLevel(userRoles, minLevel)) {
      logger.warn('Access denied: insufficient role level', {
        userId: req.user.id,
        userRoles,
        requiredLevel: minLevel,
        path: req.path,
        method: req.method,
        ip: req.ip
      });

      // Find role names for the required level
      const requiredRoleNames = Object.entries(ROLE_HIERARCHY)
        .filter(([_, level]) => level >= minLevel)
        .map(([role, _]) => role);

      return res.status(403).json({
        success: false,
        error: 'InsufficientPermissions',
        message: `Access denied. Minimum role level required: ${minLevel}`,
        requiredRoles: requiredRoleNames,
        userRoles
      });
    }

    logger.debug('Role level access granted', {
      userId: req.user.id,
      requiredLevel: minLevel,
      path: req.path,
      method: req.method
    });

    next();
  };
};

/**
 * Middleware for admin-only access
 */
const requireAdmin = requireRole('admin');

/**
 * Middleware for super-admin access
 */
const requireSuperAdmin = requireRole('super_admin');

/**
 * Middleware for moderator or higher access
 */
const requireModerator = requireMinRoleLevel(2);

/**
 * Check if user can access resource owned by specific user ID
 */
const canAccessResource = (req, resourceUserId, options = {}) => {
  const { allowSelf = true, allowAdmin = true, allowRoles = [] } = options;

  if (!req.user) {
    return false;
  }

  const userRoles = req.user.roles || [];
  const userId = req.user.id;

  // Owner access
  if (allowSelf && userId === resourceUserId) {
    return true;
  }

  // Admin access
  if (allowAdmin && hasRole(userRoles, 'admin')) {
    return true;
  }

  // Specific role access
  if (allowRoles.length > 0 && hasAnyRole(userRoles, allowRoles)) {
    return true;
  }

  return false;
};

/**
 * Middleware factory for resource ownership check
 */
const requireOwnership = (getUserIdFromParams, options = {}) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'AuthenticationRequired',
        message: 'Authentication required'
      });
    }

    const resourceUserId = getUserIdFromParams(req);

    if (!resourceUserId) {
      return res.status(400).json({
        success: false,
        error: 'InvalidRequest',
        message: 'Resource ID is required'
      });
    }

    if (!canAccessResource(req, resourceUserId, options)) {
      logger.warn('Access denied: insufficient ownership or permissions', {
        userId: req.user.id,
        resourceUserId,
        userRoles: req.user.roles,
        path: req.path,
        method: req.method,
        ip: req.ip
      });

      return res.status(403).json({
        success: false,
        error: 'AccessDenied',
        message: 'You do not have permission to access this resource'
      });
    }

    next();
  };
};

/**
 * Permission checking function
 */
const hasPermission = (user, permission, resource) => {
  if (!user || !permission) {
    return false;
  }

  const userRoles = user.roles || [];

  // Super admins have all permissions
  if (hasRole(userRoles, 'super_admin')) {
    return true;
  }

  // Admin permissions
  if (hasRole(userRoles, 'admin')) {
    const adminPermissions = [
      'read', 'write', 'delete', 'manage_users', 'manage_roles',
      'view_analytics', 'system_config', 'audit_logs'
    ];
    if (adminPermissions.includes(permission)) {
      return true;
    }
  }

  // Moderator permissions
  if (hasRole(userRoles, 'moderator')) {
    const moderatorPermissions = [
      'read', 'write', 'delete', 'manage_content', 'view_reports'
    ];
    if (moderatorPermissions.includes(permission)) {
      return true;
    }
  }

  // User permissions
  if (hasRole(userRoles, 'user')) {
    const userPermissions = [
      'read', 'write_own', 'delete_own', 'manage_profile'
    ];

    if (resource && resource.ownerId === user.id) {
      // User can do more with their own resources
      const ownResourcePermissions = [
        'read', 'write', 'delete', 'manage'
      ];
      return ownResourcePermissions.includes(permission);
    }

    return userPermissions.includes(permission);
  }

  return false;
};

/**
 * Middleware factory for permission-based authorization
 */
const requirePermission = (permission, getResource = null) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'AuthenticationRequired',
        message: 'Authentication required'
      });
    }

    const resource = getResource ? getResource(req) : null;

    if (!hasPermission(req.user, permission, resource)) {
      logger.warn('Access denied: insufficient permissions', {
        userId: req.user.id,
        userRoles: req.user.roles,
        requiredPermission: permission,
        resource: resource ? resource.id || resource.type : 'unknown',
        path: req.path,
        method: req.method,
        ip: req.ip
      });

      return res.status(403).json({
        success: false,
        error: 'InsufficientPermissions',
        message: `Access denied. Required permission: ${permission}`
      });
    }

    next();
  };
};

/**
 * Check if user can perform action on resource
 */
const canPerformAction = (user, action, resource) => {
  if (!user || !action) {
    return false;
  }

  const userRoles = user.roles || [];

  // Super admins can do anything
  if (hasRole(userRoles, 'super_admin')) {
    return true;
  }

  // Define action permissions by role
  const rolePermissions = {
    'admin': ['create', 'read', 'update', 'delete', 'manage', 'configure'],
    'moderator': ['create', 'read', 'update', 'delete', 'moderate'],
    'user': ['create_own', 'read_own', 'update_own', 'delete_own']
  };

  // Check if user has a role that allows the action
  for (const [role, permissions] of Object.entries(rolePermissions)) {
    if (hasRole(userRoles, role)) {
      if (permissions.includes(action)) {
        // Check if it's a resource-specific action and user owns the resource
        if (action.includes('_own') && resource && resource.ownerId !== user.id) {
          continue;
        }
        return true;
      }
    }
  }

  return false;
};

module.exports = {
  ROLE_HIERARCHY,
  hasRole,
  hasAnyRole,
  hasAllRoles,
  hasRoleLevel,
  requireRole,
  requireAnyRole,
  requireMinRoleLevel,
  requireAdmin,
  requireSuperAdmin,
  requireModerator,
  canAccessResource,
  requireOwnership,
  hasPermission,
  requirePermission,
  canPerformAction
};