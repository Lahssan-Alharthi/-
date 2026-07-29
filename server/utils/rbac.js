'use strict';

/**
 * أدوار النظام ومصفوفة الصلاحيات.
 * الصلاحية تُكتب بصيغة "المورد:الإجراء"، و "المورد:*" تعني كل إجراءات المورد.
 */
const ROLES = {
  admin: {
    label: 'مدير النظام',
    permissions: ['*'],
  },
  hr: {
    label: 'الموارد البشرية',
    permissions: [
      'employees:*', 'departments:*', 'attendance:*', 'leaves:*',
      'documents:*', 'requests:*', 'announcements:*', 'reports:read',
      'payroll:read',
    ],
  },
  finance: {
    label: 'الشؤون المالية',
    permissions: [
      'payroll:*', 'employees:read', 'departments:read', 'reports:read',
      'requests:read', 'requests:decide', 'attendance:read', 'fleet:read', 'trips:read',
    ],
  },
  operations: {
    label: 'إدارة العمليات',
    permissions: [
      'fleet:*', 'trips:*', 'employees:read', 'departments:read',
      'attendance:read', 'reports:read', 'announcements:create',
    ],
  },
  manager: {
    label: 'مدير مباشر',
    permissions: [
      'employees:read', 'departments:read', 'attendance:read',
      'leaves:read', 'leaves:decide', 'requests:read', 'reports:read',
      'trips:read', 'fleet:read', 'announcements:create',
    ],
  },
  employee: {
    label: 'موظف',
    permissions: ['self:*'],
  },
};

const ROLE_KEYS = Object.keys(ROLES);

/** هل يملك الدور الصلاحية المطلوبة؟ */
function can(role, permission) {
  const definition = ROLES[role];
  if (!definition) return false;

  const [resource] = permission.split(':');
  return definition.permissions.some(
    (granted) => granted === '*' || granted === permission || granted === `${resource}:*`,
  );
}

/** الأدوار التي تملك رؤية بيانات كل الموظفين. */
function isPrivileged(role) {
  return can(role, 'employees:read');
}

module.exports = { ROLES, ROLE_KEYS, can, isPrivileged };
