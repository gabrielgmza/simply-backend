// Configuración de herramientas de Aria por rol de empleado
// Cada rol tiene acceso a diferentes herramientas según sus responsabilidades

export type EmployeeRole = 'SUPER_ADMIN' | 'ADMIN' | 'COMPLIANCE' | 'SUPPORT' | 'FINANCE' | 'OPERATIONS' | 'RISK' | 'AUDITOR' | 'ANALYST';

export interface AriaTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required: string[];
  };
}

// Herramientas base disponibles
const ALL_TOOLS: Record<string, AriaTool> = {
  // === CONSULTAS ===
  get_user_info: {
    name: 'get_user_info',
    description: 'Obtener información de un usuario por ID o email',
    input_schema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'ID del usuario' },
        email: { type: 'string', description: 'Email del usuario' }
      },
      required: []
    }
  },
  
  get_investment_details: {
    name: 'get_investment_details',
    description: 'Obtener detalles de una inversión',
    input_schema: {
      type: 'object',
      properties: {
        investment_id: { type: 'string', description: 'ID de la inversión' }
      },
      required: ['investment_id']
    }
  },
  
  get_financing_details: {
    name: 'get_financing_details',
    description: 'Obtener detalles de un financiamiento',
    input_schema: {
      type: 'object',
      properties: {
        financing_id: { type: 'string', description: 'ID del financiamiento' }
      },
      required: ['financing_id']
    }
  },
  
  search_transactions: {
    name: 'search_transactions',
    description: 'Buscar transacciones con filtros',
    input_schema: {
      type: 'object',
      properties: {
        user_id: { type: 'string' },
        type: { type: 'string' },
        status: { type: 'string' },
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        min_amount: { type: 'number' },
        max_amount: { type: 'number' }
      },
      required: []
    }
  },

  get_dashboard_stats: {
    name: 'get_dashboard_stats',
    description: 'Obtener estadísticas del dashboard',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },

  // === SOPORTE ===
  get_ticket_details: {
    name: 'get_ticket_details',
    description: 'Obtener detalles de un ticket de soporte',
    input_schema: {
      type: 'object',
      properties: {
        ticket_id: { type: 'string', description: 'ID del ticket' }
      },
      required: ['ticket_id']
    }
  },
  
  respond_to_ticket: {
    name: 'respond_to_ticket',
    description: 'Enviar respuesta a un ticket de soporte',
    input_schema: {
      type: 'object',
      properties: {
        ticket_id: { type: 'string' },
        message: { type: 'string' },
        is_internal: { type: 'boolean' }
      },
      required: ['ticket_id', 'message']
    }
  },
  
  close_ticket: {
    name: 'close_ticket',
    description: 'Cerrar un ticket con resolución',
    input_schema: {
      type: 'object',
      properties: {
        ticket_id: { type: 'string' },
        resolution: { type: 'string' }
      },
      required: ['ticket_id', 'resolution']
    }
  },

  // === COMPLIANCE ===
  get_kyc_status: {
    name: 'get_kyc_status',
    description: 'Obtener estado KYC de un usuario',
    input_schema: {
      type: 'object',
      properties: {
        user_id: { type: 'string' }
      },
      required: ['user_id']
    }
  },
  
  update_kyc_status: {
    name: 'update_kyc_status',
    description: 'Actualizar estado KYC de un usuario',
    input_schema: {
      type: 'object',
      properties: {
        user_id: { type: 'string' },
        status: { type: 'string', enum: ['APPROVED', 'REJECTED', 'PENDING_REVIEW'] },
        reason: { type: 'string' }
      },
      required: ['user_id', 'status', 'reason']
    }
  },
  
  generate_compliance_report: {
    name: 'generate_compliance_report',
    description: 'Generar reporte de compliance/UIF',
    input_schema: {
      type: 'object',
      properties: {
        report_type: { type: 'string', enum: ['ROS', 'MONTHLY', 'THRESHOLD'] },
        user_id: { type: 'string' },
        date_from: { type: 'string' },
        date_to: { type: 'string' }
      },
      required: ['report_type']
    }
  },

  // === FRAUDE ===
  get_fraud_alerts: {
    name: 'get_fraud_alerts',
    description: 'Obtener alertas de fraude pendientes',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        severity: { type: 'string' },
        limit: { type: 'number' }
      },
      required: []
    }
  },
  
  review_fraud_alert: {
    name: 'review_fraud_alert',
    description: 'Revisar y resolver una alerta de fraude',
    input_schema: {
      type: 'object',
      properties: {
        alert_id: { type: 'string' },
        decision: { type: 'string', enum: ['DISMISS', 'CONFIRM', 'ESCALATE'] },
        notes: { type: 'string' }
      },
      required: ['alert_id', 'decision']
    }
  },
  
  block_user: {
    name: 'block_user',
    description: 'Bloquear un usuario por motivos de seguridad',
    input_schema: {
      type: 'object',
      properties: {
        user_id: { type: 'string' },
        reason: { type: 'string' }
      },
      required: ['user_id', 'reason']
    }
  },

  // === FINANZAS ===
  get_treasury_balance: {
    name: 'get_treasury_balance',
    description: 'Obtener balance de cuentas de tesorería',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  
  create_treasury_movement: {
    name: 'create_treasury_movement',
    description: 'Crear movimiento de tesorería',
    input_schema: {
      type: 'object',
      properties: {
        account_id: { type: 'string' },
        type: { type: 'string', enum: ['DEPOSIT', 'WITHDRAWAL', 'TRANSFER'] },
        amount: { type: 'number' },
        description: { type: 'string' }
      },
      required: ['account_id', 'type', 'amount', 'description']
    }
  },

  // === OPERACIONES ===
  process_installment_payment: {
    name: 'process_installment_payment',
    description: 'Procesar pago de cuota manualmente',
    input_schema: {
      type: 'object',
      properties: {
        installment_id: { type: 'string' },
        reason: { type: 'string' }
      },
      required: ['installment_id', 'reason']
    }
  },
  
  waive_penalty: {
    name: 'waive_penalty',
    description: 'Condonar penalidad de un financiamiento',
    input_schema: {
      type: 'object',
      properties: {
        installment_id: { type: 'string' },
        reason: { type: 'string' }
      },
      required: ['installment_id', 'reason']
    }
  },

  // === ADMIN ===
  get_system_settings: {
    name: 'get_system_settings',
    description: 'Obtener configuración del sistema',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string' }
      },
      required: []
    }
  },
  
  update_system_setting: {
    name: 'update_system_setting',
    description: 'Actualizar configuración del sistema',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        value: { type: 'string' },
        reason: { type: 'string' }
      },
      required: ['key', 'value', 'reason']
    }
  },

  get_audit_logs: {
    name: 'get_audit_logs',
    description: 'Obtener logs de auditoría',
    input_schema: {
      type: 'object',
      properties: {
        actor_id: { type: 'string' },
        action: { type: 'string' },
        resource_type: { type: 'string' },
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        limit: { type: 'number' }
      },
      required: []
    }
  },

  // === REWARDS ===
  get_user_rewards: {
    name: 'get_user_rewards',
    description: 'Obtener rewards de un usuario',
    input_schema: {
      type: 'object',
      properties: {
        user_id: { type: 'string' }
      },
      required: ['user_id']
    }
  },
  
  grant_reward: {
    name: 'grant_reward',
    description: 'Otorgar reward manual a un usuario',
    input_schema: {
      type: 'object',
      properties: {
        user_id: { type: 'string' },
        type: { type: 'string', enum: ['CASHBACK', 'POINTS', 'BONUS_RATE'] },
        points: { type: 'number' },
        amount: { type: 'number' },
        description: { type: 'string' }
      },
      required: ['user_id', 'type', 'description']
    }
  }
};

// Mapeo de herramientas por rol
const ROLE_TOOLS: Record<EmployeeRole, string[]> = {
  SUPER_ADMIN: Object.keys(ALL_TOOLS), // Acceso total
  
  ADMIN: [
    'get_user_info', 'get_investment_details', 'get_financing_details', 'search_transactions',
    'get_dashboard_stats', 'get_ticket_details', 'respond_to_ticket', 'close_ticket',
    'get_kyc_status', 'get_fraud_alerts', 'get_treasury_balance', 'get_system_settings',
    'update_system_setting', 'get_audit_logs', 'get_user_rewards', 'grant_reward'
  ],
  
  COMPLIANCE: [
    'get_user_info', 'get_investment_details', 'get_financing_details', 'search_transactions',
    'get_dashboard_stats', 'get_kyc_status', 'update_kyc_status', 'generate_compliance_report',
    'get_fraud_alerts', 'get_audit_logs'
  ],
  
  SUPPORT: [
    'get_user_info', 'get_investment_details', 'get_financing_details', 'search_transactions',
    'get_ticket_details', 'respond_to_ticket', 'close_ticket', 'get_kyc_status',
    'get_user_rewards'
  ],
  
  FINANCE: [
    'get_user_info', 'get_investment_details', 'get_financing_details', 'search_transactions',
    'get_dashboard_stats', 'get_treasury_balance', 'create_treasury_movement',
    'process_installment_payment', 'waive_penalty', 'get_audit_logs'
  ],
  
  OPERATIONS: [
    'get_user_info', 'get_investment_details', 'get_financing_details', 'search_transactions',
    'get_dashboard_stats', 'process_installment_payment', 'waive_penalty',
    'get_treasury_balance'
  ],
  
  RISK: [
    'get_user_info', 'get_investment_details', 'get_financing_details', 'search_transactions',
    'get_dashboard_stats', 'get_kyc_status', 'get_fraud_alerts', 'review_fraud_alert',
    'block_user', 'get_audit_logs'
  ],
  
  AUDITOR: [
    'get_user_info', 'get_investment_details', 'get_financing_details', 'search_transactions',
    'get_dashboard_stats', 'get_kyc_status', 'get_fraud_alerts', 'get_treasury_balance',
    'get_system_settings', 'get_audit_logs' // Solo lectura
  ],
  
  ANALYST: [
    'get_user_info', 'get_investment_details', 'get_financing_details', 'search_transactions',
    'get_dashboard_stats', 'get_kyc_status', 'get_treasury_balance', 'get_user_rewards'
  ]
};

// Prompts personalizados por rol
const ROLE_PROMPTS: Record<EmployeeRole, string> = {
  SUPER_ADMIN: `Eres Aria, asistente AI de Simply para Super Administradores. 
Tienes acceso completo a todas las funciones del sistema.
Puedes consultar, modificar configuraciones, gestionar usuarios, aprobar operaciones y más.
Siempre verifica las acciones sensibles antes de ejecutarlas.`,

  ADMIN: `Eres Aria, asistente AI de Simply para Administradores.
Puedes gestionar usuarios, tickets, configuraciones y ver reportes.
Para cambios críticos como bloqueos o configuraciones sensibles, sugiere crear una solicitud de aprobación.`,

  COMPLIANCE: `Eres Aria, asistente AI de Simply especializada en Compliance.
Tu enfoque es verificación KYC, monitoreo de transacciones sospechosas, reportes UIF y cumplimiento normativo.
Conoces las regulaciones de BCRA, UIF y PCI DSS. Ayuda a identificar actividades inusuales.`,

  SUPPORT: `Eres Aria, asistente AI de Simply para Soporte al Cliente.
Tu objetivo es ayudar a resolver tickets de usuarios de forma eficiente y amable.
Puedes consultar información de usuarios, inversiones y financiamientos para asistir mejor.
Sugiere respuestas profesionales y empáticas.`,

  FINANCE: `Eres Aria, asistente AI de Simply para el área de Finanzas.
Puedes gestionar tesorería, procesar pagos, analizar flujos de caja y reportes financieros.
Ayuda a optimizar la gestión de liquidez y controlar movimientos.`,

  OPERATIONS: `Eres Aria, asistente AI de Simply para Operaciones.
Tu enfoque es el procesamiento de transacciones, gestión de cuotas y operaciones del día a día.
Ayuda a resolver problemas operativos y optimizar procesos.`,

  RISK: `Eres Aria, asistente AI de Simply especializada en Gestión de Riesgos.
Analizas alertas de fraude, evalúas riesgos de usuarios y transacciones.
Puedes revisar alertas, bloquear usuarios sospechosos y escalar casos críticos.`,

  AUDITOR: `Eres Aria, asistente AI de Simply para Auditoría.
Tienes acceso de solo lectura a todos los datos del sistema.
Tu rol es ayudar en la revisión de transacciones, logs de auditoría y cumplimiento de controles.`,

  ANALYST: `Eres Aria, asistente AI de Simply para Analistas.
Puedes consultar datos de usuarios, inversiones, financiamientos y métricas.
Ayuda a generar insights y análisis sobre el negocio.`
};

export const ariaRoleConfig = {
  getToolsForRole(role: EmployeeRole): AriaTool[] {
    const toolNames = ROLE_TOOLS[role] || ROLE_TOOLS.ANALYST;
    return toolNames.map(name => ALL_TOOLS[name]).filter(Boolean);
  },

  getPromptForRole(role: EmployeeRole): string {
    return ROLE_PROMPTS[role] || ROLE_PROMPTS.ANALYST;
  },

  hasToolAccess(role: EmployeeRole, toolName: string): boolean {
    const allowedTools = ROLE_TOOLS[role] || [];
    return allowedTools.includes(toolName);
  },

  getAllTools(): AriaTool[] {
    return Object.values(ALL_TOOLS);
  },

  getToolByName(name: string): AriaTool | undefined {
    return ALL_TOOLS[name];
  }
};
