import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { Resend } from 'resend';

// 1. Inicializa o Carteiro (Resend)
const resend = new Resend(process.env.RESEND_API_KEY);

// 2. Inicializa o Banco de Dados (Firebase Admin)
if (!getApps().length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT as string);
    initializeApp({
      credential: cert(serviceAccount)
    });
  } catch (error) {
    console.error('Erro ao inicializar Firebase Admin:', error);
  }
}

const db = getFirestore();

export default async function handler(req: any, res: any) {
  // Garante que a Vercel só acesse isso via método GET (padrão do Cron)
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    // 3. Busca todos os produtos no banco de dados
    const productsRef = db.collection('products');
    const snapshot = await productsRef.get();

    const criticalProducts: any[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 4. Filtra quem está vencido ou vence em <= 30 dias
    snapshot.forEach(doc => {
      const product = doc.data();
      if (!product.expirationDate) return;

      const expDate = new Date(product.expirationDate);
      expDate.setHours(0, 0, 0, 0);

      const diffTime = expDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays <= 30) {
        criticalProducts.push({
          ...product,
          daysRemaining: diffDays
        });
      }
    });

    // Se não tiver nada crítico, o robô volta a dormir e avisa que deu tudo certo
    if (criticalProducts.length === 0) {
      return res.status(200).json({ message: 'Nenhum produto crítico hoje. Tudo em dia!' });
    }

    // Organiza a lista colocando os mais urgentes (vencidos) no topo
    criticalProducts.sort((a, b) => a.daysRemaining - b.daysRemaining);

    // 5. Monta o visual do E-mail (HTML)
    let htmlContent = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1e293b;">Relatório Automático de Validade</h2>
        <p style="color: #475569;">Olá! Segue o resumo diário dos produtos que precisam de atenção:</p>
        
        <table border="1" cellpadding="10" cellspacing="0" style="border-collapse: collapse; width: 100%; text-align: left;">
          <thead>
            <tr style="background-color: #f8fafc; color: #0f172a;">
              <th>Código</th>
              <th>Produto</th>
              <th>Vencimento</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
    `;

    criticalProducts.forEach(p => {
      const isExpired = p.daysRemaining < 0;
      const statusText = isExpired ? 'VENCIDO' : `Vence em ${p.daysRemaining} dias`;
      const statusColor = isExpired ? '#dc2626' : '#d97706'; // Vermelho ou Laranja

      // Formata a data para o padrão brasileiro DD/MM/YYYY
      const parts = p.expirationDate.split('-');
      const formattedDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : p.expirationDate;

      htmlContent += `
          <tr>
            <td style="color: #475569;">${p.code}</td>
            <td style="color: #0f172a; font-weight: bold;">${p.name}</td>
            <td style="color: #475569;">${formattedDate}</td>
            <td style="color: ${statusColor}; font-weight: bold;">${statusText}</td>
          </tr>
      `;
    });

    htmlContent += `
          </tbody>
        </table>
        <p style="margin-top: 30px; font-size: 12px; color: #94a3b8; text-align: center;">
          Este é um e-mail automático gerado pelo seu Sistema de Controle de Validade.
        </p>
      </div>
    `;

    // 6. Dispara o E-mail
    const { data, error } = await resend.emails.send({
      from: 'Sistema de Validade <onboarding@resend.dev>',
      to: ['josimarsouza22@gmail.com'], // ⚠️ ATENÇÃO: COLOQUE O E-MAIL DELA AQUI
      subject: '🚨 Alerta Diário: Produtos Vencidos ou Próximos do Vencimento',
      html: htmlContent,
    });

    if (error) {
      console.error('Erro ao enviar email:', error);
      return res.status(500).json({ error: 'Erro ao enviar email pelo Resend' });
    }

    return res.status(200).json({ message: 'Email enviado com sucesso!', data });

  } catch (error) {
    console.error('Erro geral na função:', error);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
}