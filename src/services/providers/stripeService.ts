import Stripe from 'stripe';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const getStripe = () => {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) throw new Error('STRIPE_SECRET_KEY no configurada');
  return new Stripe(apiKey, { apiVersion: '2023-10-16' });
};

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

export const stripeService = {
  // CRYPTO ONRAMP (via REST API)
  async getCryptoQuote(params: {
    sourceAmount: number;
    sourceCurrency: string;
    destinationCurrency: CryptoAsset;
    destinationNetwork: CryptoNetwork;
  }): Promise<CryptoQuote> {
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) throw new Error('STRIPE_SECRET_KEY no configurada');

    const response = await fetch('https://api.stripe.com/v1/crypto/onramp/quotes?' + new URLSearchParams({
      source_amount: params.sourceAmount.toString(),
      source_currency: params.sourceCurrency,
      'destination_currencies[]': params.destinationCurrency,
      'destination_networks[]': params.destinationNetwork
    }), { headers: { 'Authorization': `Bearer ${apiKey}` } });

    if (!response.ok) {
      const error = await response.json() as { error?: { message?: string } };
      throw new Error(error.error?.message || 'Error obteniendo cotización');
    }

    const data = await response.json() as any;
    const quote = data.destination_network_quotes?.[params.destinationNetwork]?.[0];
    if (!quote) throw new Error('No hay cotización disponible');

    return {
      asset: params.destinationCurrency,
      network: params.destinationNetwork,
      sourceAmount: params.sourceAmount,
      sourceCurrency: params.sourceCurrency,
      destinationAmount: quote.destination_amount || '0',
      networkFee: parseFloat(quote.fees?.network_fee_monetary || '0'),
      transactionFee: parseFloat(quote.fees?.transaction_fee_monetary || '0'),
      totalAmount: parseFloat(quote.source_total_amount || '0'),
      exchangeRate: params.sourceAmount / parseFloat(quote.destination_amount || '1')
    };
  },

  async createCryptoOnrampSession(params: {
    userId: string;
    walletAddress: string;
    destinationCurrency: CryptoAsset;
    destinationNetwork: CryptoNetwork;
    destinationAmount?: string;
    sourceAmount?: number;
    sourceCurrency?: string;
  }): Promise<{ sessionId: string; clientSecret: string; redirectUrl: string }> {
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) throw new Error('STRIPE_SECRET_KEY no configurada');

    const user = await prisma.users.findUnique({
      where: { id: params.userId },
      select: { id: true, email: true, first_name: true, last_name: true }
    });
    if (!user) throw new Error('Usuario no encontrado');

    const walletKey = params.destinationNetwork === 'bitcoin' ? 'bitcoin' 
      : params.destinationNetwork === 'solana' ? 'solana' : 'ethereum';

    const body = new URLSearchParams();
    body.append(`wallet_addresses[${walletKey}]`, params.walletAddress);
    body.append('destination_currency', params.destinationCurrency);
    body.append('destination_network', params.destinationNetwork);
    if (params.destinationAmount) body.append('destination_amount', params.destinationAmount);
    if (params.sourceAmount) {
      body.append('source_amount', params.sourceAmount.toString());
      body.append('source_currency', params.sourceCurrency || 'usd');
    }

    const response = await fetch('https://api.stripe.com/v1/crypto/onramp_sessions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });

    if (!response.ok) {
      const error = await response.json() as { error?: { message?: string } };
      throw new Error(error.error?.message || 'Error creando sesión');
    }

    const session = await response.json() as any;

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
        metadata: session
      }
    });

    return { sessionId: session.id, clientSecret: session.client_secret || '', redirectUrl: session.redirect_url || '' };
  },

  async getCryptoSessionStatus(sessionId: string): Promise<{ status: string; destinationAmount?: string; transactionHash?: string }> {
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) throw new Error('STRIPE_SECRET_KEY no configurada');

    const response = await fetch(`https://api.stripe.com/v1/crypto/onramp_sessions/${sessionId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    if (!response.ok) throw new Error('Sesión no encontrada');

    const session = await response.json() as any;
    return { status: session.status, destinationAmount: session.transaction_details?.destination_amount, transactionHash: session.transaction_details?.transaction_hash };
  },

  async handleCryptoWebhook(payload: any): Promise<void> {
    const session = payload;
    const dbSession = await prisma.crypto_onramp_sessions.findUnique({ where: { stripe_session_id: session.id } });
    if (!dbSession) return;

    await prisma.crypto_onramp_sessions.update({
      where: { id: dbSession.id },
      data: {
        status: session.status,
        destination_amount: session.transaction_details?.destination_amount ? new Prisma.Decimal(session.transaction_details.destination_amount) : dbSession.destination_amount,
        transaction_hash: session.transaction_details?.transaction_hash,
        completed_at: session.status === 'fulfillment_complete' ? new Date() : null,
        metadata: session
      }
    });

    if (session.status === 'fulfillment_complete') {
      await prisma.transactions.create({
        data: {
          user_id: dbSession.user_id,
          type: 'TRANSFER_IN',
          amount: dbSession.source_amount || new Prisma.Decimal(0),
          total: dbSession.source_amount || new Prisma.Decimal(0),
          currency: dbSession.source_currency || 'USD',
          status: 'COMPLETED',
          description: `Compra crypto ${dbSession.destination_amount} ${dbSession.destination_currency?.toUpperCase()}`,
          reference: session.id,
          metadata: { crypto: dbSession.destination_currency, network: dbSession.destination_network, txHash: session.transaction_details?.transaction_hash }
        }
      });
    }
  },

  // PIX PAYMENTS
  async createPIXPayment(params: { userId: string; amount: number; description?: string; expiresInSeconds?: number }): Promise<PIXPaymentResult> {
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
      payment_method_options: { pix: { expires_after_seconds: params.expiresInSeconds || 3600 } },
      metadata: { userId: params.userId, description: params.description || 'Pago PIX' }
    });

    const confirmedIntent = await stripe.paymentIntents.confirm(paymentIntent.id, {
      payment_method_data: { type: 'pix', billing_details: { email: user.email, name: `${user.first_name} ${user.last_name}` } },
      return_url: `${process.env.APP_URL || 'https://paysur.com.ar'}/pix/callback`
    });

    const pixAction = confirmedIntent.next_action?.pix_display_qr_code;
    if (!pixAction) throw new Error('No se pudo generar QR PIX');

    const expiresAt = pixAction.expires_at ? new Date(pixAction.expires_at * 1000) : new Date(Date.now() + 3600000);

    await prisma.pix_payments.create({
      data: {
        user_id: params.userId,
        stripe_payment_intent_id: paymentIntent.id,
        amount: new Prisma.Decimal(params.amount / 100),
        currency: 'BRL',
        status: 'pending',
        qr_code_url: pixAction.image_url_png || '',
        qr_code_data: pixAction.data || '',
        expires_at: expiresAt,
        description: params.description
      }
    });

    return { paymentIntentId: paymentIntent.id, qrCodeUrl: pixAction.image_url_png || '', qrCodeData: pixAction.data || '', expiresAt, amount: params.amount / 100, currency: 'BRL' };
  },

  async getPIXPaymentStatus(paymentIntentId: string): Promise<{ status: string; paid: boolean; paidAt?: Date }> {
    const stripe = getStripe();
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    return { status: intent.status, paid: intent.status === 'succeeded', paidAt: intent.status === 'succeeded' ? new Date() : undefined };
  },

  async handlePIXWebhook(event: Stripe.Event): Promise<void> {
    if (event.type !== 'payment_intent.succeeded' && event.type !== 'payment_intent.payment_failed') return;

    const intent = event.data.object as Stripe.PaymentIntent;
    if (!intent.payment_method_types?.includes('pix')) return;

    const dbPayment = await prisma.pix_payments.findFirst({ where: { stripe_payment_intent_id: intent.id } });
    if (!dbPayment) return;

    const newStatus = intent.status === 'succeeded' ? 'completed' : 'failed';
    await prisma.pix_payments.update({ where: { id: dbPayment.id }, data: { status: newStatus, paid_at: newStatus === 'completed' ? new Date() : null } });

    if (newStatus === 'completed') {
      const amountARS = Number(dbPayment.amount) * 50;
      await prisma.transactions.create({
        data: { user_id: dbPayment.user_id, type: 'TRANSFER_IN', amount: new Prisma.Decimal(amountARS), total: new Prisma.Decimal(amountARS), currency: 'ARS', status: 'COMPLETED', description: `Depósito PIX - R$ ${dbPayment.amount}`, reference: intent.id, metadata: { originalAmount: Number(dbPayment.amount), originalCurrency: 'BRL' } }
      });
    }
  },

  // CARD PAYMENTS
  async createCardPayment(params: { userId: string; amount: number; currency: string; description?: string }): Promise<{ clientSecret: string; paymentIntentId: string }> {
    const stripe = getStripe();
    const paymentIntent = await stripe.paymentIntents.create({
      amount: params.amount,
      currency: params.currency.toLowerCase(),
      payment_method_types: ['card'],
      metadata: { userId: params.userId, description: params.description || 'Pago con tarjeta' }
    });
    return { clientSecret: paymentIntent.client_secret!, paymentIntentId: paymentIntent.id };
  },

  // WEBHOOKS
  verifyWebhookSignature(payload: string | Buffer, signature: string): Stripe.Event {
    const stripe = getStripe();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET no configurado');
    return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  },

  async handleWebhook(event: Stripe.Event): Promise<void> {
    console.log(`Stripe webhook: ${event.type}`);
    if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') {
      await this.handlePIXWebhook(event);
    }
  }
};
