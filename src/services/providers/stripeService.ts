import Stripe from 'stripe';
import { PrismaClient, Prisma } from '@prisma/client';
import { auditLogService } from '../backoffice/auditLogService';

const prisma = new PrismaClient();

// Stripe se inicializa con la API key del environment
const getStripe = () => {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) throw new Error('STRIPE_SECRET_KEY no configurada');
  return new Stripe(apiKey, { apiVersion: '2024-12-18.acacia' });
};

// ============================================
// TIPOS
// ============================================
export type CryptoAsset = 'eth' | 'btc' | 'sol' | 'usdc' | 'matic' | 'avax';
export type CryptoNetwork = 'ethereum' | 'bitcoin' | 'solana' | 'polygon' | 'avalanche' | 'base';

interface CryptoQuote {
  asset: CryptoAsset;
  network: CryptoNetwork;
  sourceAmount: number;
  sourceCurrency: string;
  destinationAmount: string;
  networkFee: number;
  transactionFee: number;
  totalAmount: number;
  exchangeRate: number;
}

interface PIXPaymentResult {
  paymentIntentId: string;
  qrCodeUrl: string;
  qrCodeData: string;
  expiresAt: Date;
  amount: number;
  currency: string;
}

// ============================================
// STRIPE SERVICE
// ============================================
export const stripeService = {
  // ==========================================
  // CRYPTO ONRAMP
  // ==========================================
  
  // Obtener cotización de crypto
  async getCryptoQuote(params: {
    sourceAmount: number;
    sourceCurrency: string;
    destinationCurrency: CryptoAsset;
    destinationNetwork: CryptoNetwork;
  }): Promise<CryptoQuote> {
    const stripe = getStripe();
    
    const quotes = await stripe.crypto.onramp.quotes.list({
      source_amount: params.sourceAmount.toString(),
      source_currency: params.sourceCurrency,
      destination_currencies: [params.destinationCurrency],
      destination_networks: [params.destinationNetwork]
    });

    const quote = quotes.data[0];
    if (!quote) throw new Error('No se pudo obtener cotización');

    const networkQuote = quote.destination_network_quotes?.[params.destinationNetwork]?.[0];
    if (!networkQuote) throw new Error('Red no disponible');

    return {
      asset: params.destinationCurrency,
      network: params.destinationNetwork,
      sourceAmount: params.sourceAmount,
      sourceCurrency: params.sourceCurrency,
      destinationAmount: networkQuote.destination_amount || '0',
      networkFee: parseFloat(networkQuote.fees?.network_fee_monetary || '0'),
      transactionFee: parseFloat(networkQuote.fees?.transaction_fee_monetary || '0'),
      totalAmount: parseFloat(networkQuote.source_total_amount || '0'),
      exchangeRate: params.sourceAmount / parseFloat(networkQuote.destination_amount || '1')
    };
  },

  // Crear sesión de crypto onramp
  async createCryptoOnrampSession(params: {
    userId: string;
    walletAddress: string;
    destinationCurrency: CryptoAsset;
    destinationNetwork: CryptoNetwork;
    destinationAmount?: string;
    sourceAmount?: number;
    sourceCurrency?: string;
  }): Promise<{ sessionId: string; clientSecret: string; redirectUrl: string }> {
    const stripe = getStripe();

    const user = await prisma.users.findUnique({
      where: { id: params.userId },
      select: { id: true, email: true, first_name: true, last_name: true }
    });
    if (!user) throw new Error('Usuario no encontrado');

    // Mapear red a tipo de wallet
    const walletKey = params.destinationNetwork === 'bitcoin' ? 'bitcoin' 
      : params.destinationNetwork === 'solana' ? 'solana' 
      : 'ethereum';

    const sessionParams: any = {
      wallet_addresses: { [walletKey]: params.walletAddress },
      destination_currency: params.destinationCurrency,
      destination_network: params.destinationNetwork,
    };

    if (params.destinationAmount) {
      sessionParams.destination_amount = params.destinationAmount;
    }
    if (params.sourceAmount) {
      sessionParams.source_amount = params.sourceAmount.toString();
      sessionParams.source_currency = params.sourceCurrency || 'usd';
    }

    const session = await stripe.crypto.onrampSessions.create(sessionParams);

    // Guardar en DB
    await prisma.crypto_onramp_sessions.create({
      data: {
        id: session.id,
        user_id: params.userId,
        stripe_session_id: session.id,
        wallet_address: params.walletAddress,
        destination_currency: params.destinationCurrency,
        destination_network: params.destinationNetwork,
        destination_amount: params.destinationAmount ? new Prisma.Decimal(params.destinationAmount) : null,
        source_amount: params.sourceAmount ? new Prisma.Decimal(params.sourceAmount) : null,
        source_currency: params.sourceCurrency || 'usd',
        status: 'initialized',
        metadata: session as any
      }
    });

    return {
      sessionId: session.id,
      clientSecret: session.client_secret!,
      redirectUrl: session.redirect_url || ''
    };
  },

  // Obtener estado de sesión crypto
  async getCryptoSessionStatus(sessionId: string): Promise<{
    status: string;
    destinationAmount?: string;
    transactionHash?: string;
  }> {
    const stripe = getStripe();
    const session = await stripe.crypto.onrampSessions.retrieve(sessionId);
    
    return {
      status: session.status,
      destinationAmount: session.transaction_details?.destination_amount,
      transactionHash: (session as any).transaction_details?.transaction_hash
    };
  },

  // Webhook handler para crypto onramp
  async handleCryptoWebhook(event: Stripe.Event): Promise<void> {
    if (event.type !== 'crypto.onramp_session.updated') return;

    const session = event.data.object as any;
    const dbSession = await prisma.crypto_onramp_sessions.findUnique({
      where: { stripe_session_id: session.id }
    });
    if (!dbSession) return;

    await prisma.crypto_onramp_sessions.update({
      where: { id: dbSession.id },
      data: {
        status: session.status,
        destination_amount: session.transaction_details?.destination_amount 
          ? new Prisma.Decimal(session.transaction_details.destination_amount) 
          : dbSession.destination_amount,
        transaction_hash: session.transaction_details?.transaction_hash,
        completed_at: session.status === 'fulfillment_complete' ? new Date() : null,
        metadata: session
      }
    });

    // Si completó, crear transacción en el sistema
    if (session.status === 'fulfillment_complete') {
      await prisma.transactions.create({
        data: {
          user_id: dbSession.user_id,
          type: 'CRYPTO_PURCHASE',
          amount: dbSession.source_amount || new Prisma.Decimal(0),
          currency: dbSession.source_currency || 'USD',
          status: 'COMPLETED',
          description: `Compra de ${dbSession.destination_amount} ${dbSession.destination_currency?.toUpperCase()}`,
          reference: session.id,
          metadata: {
            crypto: dbSession.destination_currency,
            network: dbSession.destination_network,
            txHash: session.transaction_details?.transaction_hash,
            walletAddress: dbSession.wallet_address
          }
        }
      });
    }
  },

  // ==========================================
  // PIX PAYMENTS (Brasil)
  // ==========================================

  // Crear pago PIX
  async createPIXPayment(params: {
    userId: string;
    amount: number; // en centavos BRL
    description?: string;
    expiresInSeconds?: number;
  }): Promise<PIXPaymentResult> {
    const stripe = getStripe();

    const user = await prisma.users.findUnique({
      where: { id: params.userId },
      select: { id: true, email: true, first_name: true, last_name: true }
    });
    if (!user) throw new Error('Usuario no encontrado');

    const paymentIntent = await stripe.paymentIntents.create({
      amount: params.amount,
      currency: 'brl',
      payment_method_types: ['pix'],
      payment_method_options: {
        pix: {
          expires_after_seconds: params.expiresInSeconds || 3600 // 1 hora default
        }
      },
      metadata: {
        userId: params.userId,
        description: params.description || 'Pago PIX'
      }
    });

    // Confirmar para obtener QR code
    const confirmedIntent = await stripe.paymentIntents.confirm(paymentIntent.id, {
      payment_method_data: {
        type: 'pix',
        billing_details: {
          email: user.email,
          name: `${user.first_name} ${user.last_name}`
        }
      },
      return_url: `${process.env.APP_URL || 'https://paysur.com.ar'}/pix/callback`
    });

    const pixAction = confirmedIntent.next_action?.pix_display_qr_code;
    if (!pixAction) throw new Error('No se pudo generar QR PIX');

    // Guardar en DB
    await prisma.pix_payments.create({
      data: {
        user_id: params.userId,
        stripe_payment_intent_id: paymentIntent.id,
        amount: new Prisma.Decimal(params.amount / 100),
        currency: 'BRL',
        status: 'pending',
        qr_code_url: pixAction.image_url_png || '',
        qr_code_data: pixAction.data || '',
        expires_at: new Date(pixAction.expires_at * 1000),
        description: params.description
      }
    });

    return {
      paymentIntentId: paymentIntent.id,
      qrCodeUrl: pixAction.image_url_png || pixAction.image_url_svg || '',
      qrCodeData: pixAction.data || '',
      expiresAt: new Date(pixAction.expires_at * 1000),
      amount: params.amount / 100,
      currency: 'BRL'
    };
  },

  // Verificar estado de pago PIX
  async getPIXPaymentStatus(paymentIntentId: string): Promise<{
    status: string;
    paid: boolean;
    paidAt?: Date;
  }> {
    const stripe = getStripe();
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

    return {
      status: intent.status,
      paid: intent.status === 'succeeded',
      paidAt: intent.status === 'succeeded' ? new Date() : undefined
    };
  },

  // Webhook handler para PIX
  async handlePIXWebhook(event: Stripe.Event): Promise<void> {
    if (!['payment_intent.succeeded', 'payment_intent.payment_failed'].includes(event.type)) return;

    const intent = event.data.object as Stripe.PaymentIntent;
    if (intent.payment_method_types?.[0] !== 'pix') return;

    const dbPayment = await prisma.pix_payments.findFirst({
      where: { stripe_payment_intent_id: intent.id }
    });
    if (!dbPayment) return;

    const newStatus = intent.status === 'succeeded' ? 'completed' : 'failed';

    await prisma.pix_payments.update({
      where: { id: dbPayment.id },
      data: {
        status: newStatus,
        paid_at: newStatus === 'completed' ? new Date() : null
      }
    });

    // Si completó, acreditar en cuenta del usuario
    if (newStatus === 'completed') {
      // Convertir BRL a ARS usando cotización (simplificado)
      const amountARS = Number(dbPayment.amount) * 50; // TODO: usar cotización real

      await prisma.users.update({
        where: { id: dbPayment.user_id },
        data: { balance: { increment: amountARS } }
      });

      await prisma.transactions.create({
        data: {
          user_id: dbPayment.user_id,
          type: 'PIX_DEPOSIT',
          amount: new Prisma.Decimal(amountARS),
          currency: 'ARS',
          status: 'COMPLETED',
          description: `Depósito PIX - R$ ${dbPayment.amount}`,
          reference: intent.id,
          metadata: { originalAmount: Number(dbPayment.amount), originalCurrency: 'BRL' }
        }
      });
    }
  },

  // ==========================================
  // CARD PAYMENTS (Internacional)
  // ==========================================

  // Crear pago con tarjeta
  async createCardPayment(params: {
    userId: string;
    amount: number;
    currency: string;
    description?: string;
  }): Promise<{ clientSecret: string; paymentIntentId: string }> {
    const stripe = getStripe();

    const paymentIntent = await stripe.paymentIntents.create({
      amount: params.amount,
      currency: params.currency.toLowerCase(),
      payment_method_types: ['card'],
      metadata: {
        userId: params.userId,
        description: params.description || 'Pago con tarjeta'
      }
    });

    return {
      clientSecret: paymentIntent.client_secret!,
      paymentIntentId: paymentIntent.id
    };
  },

  // ==========================================
  // WEBHOOKS
  // ==========================================

  // Verificar firma de webhook
  verifyWebhookSignature(payload: string | Buffer, signature: string): Stripe.Event {
    const stripe = getStripe();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET no configurado');
    
    return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  },

  // Handler general de webhooks
  async handleWebhook(event: Stripe.Event): Promise<void> {
    console.log(`Stripe webhook: ${event.type}`);

    switch (event.type) {
      case 'crypto.onramp_session.updated':
        await this.handleCryptoWebhook(event);
        break;
      case 'payment_intent.succeeded':
      case 'payment_intent.payment_failed':
        await this.handlePIXWebhook(event);
        break;
    }
  }
};
