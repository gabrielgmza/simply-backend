import { PrismaClient } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';

const prisma = new PrismaClient();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || 'sk-ant-api03-dummy-key'
});

const SYSTEM_PROMPT = `Eres Aria, la asistente AI de Simply, una plataforma fintech argentina.

Tu rol es ayudar a los empleados del backoffice con:
- Consultas sobre usuarios y leads
- Explicar métricas y estadísticas
- Generar reportes y análisis
- Responder preguntas del negocio
- Sugerir acciones basadas en datos

Características de Simply:
- Plataforma fintech que combina inversiones FCI con financiamiento
- Usuarios invierten en FCIs con rendimiento del 22.08% anual
- Pueden acceder a financiamiento del 15% de su inversión
- 4 niveles de usuario: Plata, Oro, Black, Diamante
- Sistema de KYC con didit
- Integración con Banco BIND

Instrucciones:
- Sé concisa y directa
- Usa datos cuando estén disponibles
- Sugiere acciones concretas
- Habla en español rioplatense (argentino)
- Si no sabés algo, decilo claramente

Fecha actual: ${new Date().toLocaleDateString('es-AR')}`;

export const ariaService = {
  async chat(data: {
    employeeId: string;
    message: string;
    conversationId?: string;
  }) {
    const { employeeId, message, conversationId } = data;

    // Obtener o crear conversación
    let conversation;
    if (conversationId) {
      conversation = await prisma.aria_conversations.findUnique({
        where: { id: conversationId }
      });
    }

    const messages = conversation 
      ? JSON.parse(conversation.messages as string)
      : [];

    // Agregar mensaje del usuario
    messages.push({
      role: 'user',
      content: message
    });

    try {
      // Llamar a Claude API
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: messages
      });

      const assistantMessage = response.content[0].type === 'text' 
        ? response.content[0].text 
        : '';

      // Agregar respuesta de Aria
      messages.push({
        role: 'assistant',
        content: assistantMessage
      });

      // Guardar conversación
      if (conversation) {
        conversation = await prisma.aria_conversations.update({
          where: { id: conversationId },
          data: {
            messages: JSON.stringify(messages),
            updated_at: new Date()
          }
        });
      } else {
        // Crear nueva conversación
        const title = message.slice(0, 50) + (message.length > 50 ? '...' : '');
        conversation = await prisma.aria_conversations.create({
          data: {
            employee_id: employeeId,
            title,
            messages: JSON.stringify(messages)
          }
        });
      }

      return {
        conversationId: conversation.id,
        message: assistantMessage,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens
        }
      };
    } catch (error: any) {
      console.error('Aria chat error:', error);
      throw new Error('Error al procesar el mensaje');
    }
  },

  async getConversations(employeeId: string, limit: number = 20) {
    const conversations = await prisma.aria_conversations.findMany({
      where: { employee_id: employeeId },
      orderBy: { updated_at: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        created_at: true,
        updated_at: true
      }
    });

    return conversations;
  },

  async getConversation(id: string, employeeId: string) {
    const conversation = await prisma.aria_conversations.findFirst({
      where: {
        id,
        employee_id: employeeId
      }
    });

    if (!conversation) {
      throw new Error('Conversación no encontrada');
    }

    return {
      id: conversation.id,
      title: conversation.title,
      messages: JSON.parse(conversation.messages as string),
      createdAt: conversation.created_at,
      updatedAt: conversation.updated_at
    };
  },

  async deleteConversation(id: string, employeeId: string) {
    const conversation = await prisma.aria_conversations.findFirst({
      where: {
        id,
        employee_id: employeeId
      }
    });

    if (!conversation) {
      throw new Error('Conversación no encontrada');
    }

    await prisma.aria_conversations.delete({
      where: { id }
    });
  },

  async updateTitle(id: string, employeeId: string, title: string) {
    const conversation = await prisma.aria_conversations.updateMany({
      where: {
        id,
        employee_id: employeeId
      },
      data: { title }
    });

    if (conversation.count === 0) {
      throw new Error('Conversación no encontrada');
    }
  }
};
