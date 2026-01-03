// ============================================
// EXTERNAL SERVICES CONFIG
// Simply Backend v3.8.0
// ============================================

export interface ExternalServicesConfig {
  firebase: FirebaseConfig;
  sns: AWSSNSConfig;
  telegram: TelegramConfig;
  email: EmailConfig;
}

interface FirebaseConfig {
  enabled: boolean;
  projectId: string;
  serviceAccountPath?: string;
  serviceAccount?: {
    type: string;
    project_id: string;
    private_key_id: string;
    private_key: string;
    client_email: string;
    client_id: string;
    auth_uri: string;
    token_uri: string;
    auth_provider_x509_cert_url: string;
    client_x509_cert_url: string;
  };
}

interface AWSSNSConfig {
  enabled: boolean;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  // Topics ARN
  emergencyTopicArn?: string;  // SMS + Email para emergencias
  alertsTopicArn?: string;     // Email para alertas
}

interface TelegramConfig {
  enabled: boolean;
  botToken?: string;
  // Chat IDs de grupos
  alertsChatId?: string;       // Grupo alertas generales
  emergencyChatId?: string;    // Grupo emergencias (puede ser el mismo)
}

interface EmailConfig {
  enabled: boolean;
  provider: 'ses' | 'smtp';    // SES preferido (AWS)
  fromEmail: string;
  fromName: string;
  // SES usa credenciales de AWS SNS
}

// ==========================================
// CARGAR CONFIGURACIÓN DESDE ENV
// ==========================================

export const externalServicesConfig: ExternalServicesConfig = {
  firebase: {
    enabled: !!process.env.FIREBASE_PROJECT_ID,
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    serviceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
    ...(process.env.FIREBASE_PRIVATE_KEY && {
      serviceAccount: {
        type: 'service_account',
        project_id: process.env.FIREBASE_PROJECT_ID || '',
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID || '',
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL || '',
        client_id: process.env.FIREBASE_CLIENT_ID || '',
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
        auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
        client_x509_cert_url: process.env.FIREBASE_CERT_URL || ''
      }
    })
  },
  
  sns: {
    enabled: !!process.env.AWS_SNS_REGION,
    region: process.env.AWS_SNS_REGION || process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    emergencyTopicArn: process.env.AWS_SNS_EMERGENCY_TOPIC_ARN,
    alertsTopicArn: process.env.AWS_SNS_ALERTS_TOPIC_ARN
  },
  
  telegram: {
    enabled: !!process.env.TELEGRAM_BOT_TOKEN,
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    alertsChatId: process.env.TELEGRAM_ALERTS_CHAT_ID,
    emergencyChatId: process.env.TELEGRAM_EMERGENCY_CHAT_ID || process.env.TELEGRAM_ALERTS_CHAT_ID
  },
  
  email: {
    enabled: !!process.env.AWS_SES_FROM_EMAIL || !!process.env.EMAIL_FROM,
    provider: 'ses',
    fromEmail: process.env.AWS_SES_FROM_EMAIL || process.env.EMAIL_FROM || 'no-reply@simply.com.ar',
    fromName: process.env.EMAIL_FROM_NAME || 'Simply'
  }
};

// ==========================================
// FIREBASE ADMIN SETUP
// ==========================================

import * as admin from 'firebase-admin';

let firebaseApp: admin.app.App | null = null;

export const initializeFirebase = (): admin.app.App | null => {
  if (!externalServicesConfig.firebase.enabled) {
    console.log('⚠️ Firebase no configurado');
    return null;
  }
  
  if (firebaseApp) {
    return firebaseApp;
  }
  
  try {
    const credential = externalServicesConfig.firebase.serviceAccount
      ? admin.credential.cert(externalServicesConfig.firebase.serviceAccount as admin.ServiceAccount)
      : externalServicesConfig.firebase.serviceAccountPath
        ? admin.credential.cert(require(externalServicesConfig.firebase.serviceAccountPath))
        : admin.credential.applicationDefault();
    
    firebaseApp = admin.initializeApp({
      credential,
      projectId: externalServicesConfig.firebase.projectId
    });
    
    console.log('✅ Firebase inicializado');
    return firebaseApp;
  } catch (error) {
    console.error('❌ Error inicializando Firebase:', error);
    return null;
  }
};

export const getFirebaseAdmin = (): admin.app.App | null => firebaseApp;

// ==========================================
// AWS SNS CLIENT (SMS + Email)
// ==========================================

import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

let snsClient: SNSClient | null = null;

const getSNSClient = (): SNSClient | null => {
  if (!externalServicesConfig.sns.enabled) {
    return null;
  }
  
  if (!snsClient) {
    snsClient = new SNSClient({
      region: externalServicesConfig.sns.region,
      ...(externalServicesConfig.sns.accessKeyId && {
        credentials: {
          accessKeyId: externalServicesConfig.sns.accessKeyId,
          secretAccessKey: externalServicesConfig.sns.secretAccessKey || ''
        }
      })
    });
  }
  
  return snsClient;
};

export const sendSNSAlert = async (
  message: string,
  subject: string,
  type: 'emergency' | 'alert' = 'alert'
): Promise<boolean> => {
  const client = getSNSClient();
  if (!client) {
    console.log('⚠️ AWS SNS no configurado');
    return false;
  }
  
  const topicArn = type === 'emergency'
    ? externalServicesConfig.sns.emergencyTopicArn
    : externalServicesConfig.sns.alertsTopicArn;
  
  if (!topicArn) {
    console.log(`⚠️ SNS Topic ARN no configurado para: ${type}`);
    return false;
  }
  
  try {
    await client.send(new PublishCommand({
      TopicArn: topicArn,
      Message: message,
      Subject: subject.substring(0, 100) // SNS limit
    }));
    
    console.log(`📤 SNS [${type}]: ${subject}`);
    return true;
  } catch (error) {
    console.error('Error enviando SNS:', error);
    return false;
  }
};

// Enviar SMS directo (sin topic)
export const sendSMS = async (
  phoneNumber: string,
  message: string
): Promise<boolean> => {
  const client = getSNSClient();
  if (!client) {
    return false;
  }
  
  try {
    await client.send(new PublishCommand({
      PhoneNumber: phoneNumber,
      Message: message.substring(0, 160) // SMS limit
    }));
    
    console.log(`📱 SMS enviado a: ${phoneNumber.substring(0, 6)}***`);
    return true;
  } catch (error) {
    console.error('Error enviando SMS:', error);
    return false;
  }
};

// ==========================================
// TELEGRAM BOT
// ==========================================

export const sendTelegramMessage = async (
  message: string,
  type: 'alert' | 'emergency' = 'alert',
  parseMode: 'HTML' | 'Markdown' = 'HTML'
): Promise<boolean> => {
  if (!externalServicesConfig.telegram.enabled) {
    console.log('⚠️ Telegram no configurado');
    return false;
  }
  
  const chatId = type === 'emergency'
    ? externalServicesConfig.telegram.emergencyChatId
    : externalServicesConfig.telegram.alertsChatId;
  
  if (!chatId) {
    console.log(`⚠️ Telegram Chat ID no configurado para: ${type}`);
    return false;
  }
  
  const botToken = externalServicesConfig.telegram.botToken;
  
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: parseMode,
          disable_web_page_preview: true
        })
      }
    );
    
    if (!response.ok) {
      throw new Error(`Telegram API error: ${response.status}`);
    }
    
    console.log(`📬 Telegram [${type}]: mensaje enviado`);
    return true;
  } catch (error) {
    console.error('Error enviando Telegram:', error);
    return false;
  }
};

// Formatear alerta para Telegram
export const formatTelegramAlert = (
  title: string,
  priority: string,
  message: string,
  data?: Record<string, any>
): string => {
  const emoji = {
    LOW: 'ℹ️',
    MEDIUM: '⚠️',
    HIGH: '🔶',
    CRITICAL: '🔴',
    EMERGENCY: '🚨'
  }[priority] || '📢';
  
  let text = `${emoji} <b>${title}</b>\n\n${message}`;
  
  if (data) {
    text += '\n\n<b>Detalles:</b>';
    for (const [key, value] of Object.entries(data)) {
      if (value !== null && value !== undefined) {
        text += `\n• ${key}: <code>${value}</code>`;
      }
    }
  }
  
  text += `\n\n🕐 ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`;
  
  return text;
};

// ==========================================
// ENV TEMPLATE
// ==========================================

export const envTemplate = `
# ===========================================
# SIMPLY BACKEND v3.8.0 - ENVIRONMENT VARIABLES
# ===========================================

# Database
DATABASE_URL="postgresql://user:password@host:5432/simply?schema=public"

# Server
PORT=8080
NODE_ENV=production

# JWT
JWT_SECRET="your-super-secret-jwt-key-min-32-chars"
JWT_EXPIRES_IN="24h"

# Internal API Key (para llamadas entre servicios)
INTERNAL_API_KEY="your-internal-api-key"

# ===========================================
# FIREBASE (Push Notifications - App Móvil)
# ===========================================
FIREBASE_PROJECT_ID="your-project-id"
FIREBASE_PRIVATE_KEY_ID="your-key-id"
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"
FIREBASE_CLIENT_EMAIL="firebase-adminsdk@your-project.iam.gserviceaccount.com"
FIREBASE_CLIENT_ID="123456789"
FIREBASE_CERT_URL="https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk..."

# ===========================================
# AWS SNS (SMS + Email para Emergencias)
# ===========================================
AWS_REGION="us-east-1"
AWS_SNS_REGION="us-east-1"
AWS_ACCESS_KEY_ID="AKIA..."
AWS_SECRET_ACCESS_KEY="your-secret"
AWS_SNS_EMERGENCY_TOPIC_ARN="arn:aws:sns:us-east-1:123456789:simply-emergency"
AWS_SNS_ALERTS_TOPIC_ARN="arn:aws:sns:us-east-1:123456789:simply-alerts"

# ===========================================
# TELEGRAM BOT (Alertas del Equipo)
# ===========================================
# Crear bot con @BotFather, obtener token
# Agregar bot al grupo, obtener chat_id con: https://api.telegram.org/bot<TOKEN>/getUpdates
TELEGRAM_BOT_TOKEN="123456789:ABC-DEF..."
TELEGRAM_ALERTS_CHAT_ID="-100123456789"
TELEGRAM_EMERGENCY_CHAT_ID="-100123456789"

# ===========================================
# AWS SES (Email)
# ===========================================
AWS_SES_FROM_EMAIL="alertas@simply.com.ar"
EMAIL_FROM_NAME="Simply Alertas"

# ===========================================
# PROVIDERS
# ===========================================
# BIND
BIND_API_URL="https://api.bind.com.ar"
BIND_API_KEY="your-bind-key"
BIND_API_SECRET="your-bind-secret"

# DIDIT (KYC)
DIDIT_API_URL="https://api.didit.me"
DIDIT_CLIENT_ID="your-client-id"
DIDIT_CLIENT_SECRET="your-client-secret"

# STRIPE
STRIPE_SECRET_KEY="sk_live_xxxx"
STRIPE_WEBHOOK_SECRET="whsec_xxxx"
`;

console.log('📋 External services config loaded (AWS SNS + Telegram)');
