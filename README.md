# AGR Gestão — banco compartilhado

O site original foi adaptado para persistir clientes, serviços, pagamentos, históricos e colaboradores no PostgreSQL do Supabase. As contas usam Supabase Auth. Os dados não são mais gravados no localStorage. Senhas e chaves administrativas não ficam no HTML.

## Ativar (necessário antes de usar)

1. Crie um projeto Supabase exclusivo da AGR, ou instale a integração Supabase na Vercel.
2. No SQL Editor do Supabase, execute `supabase/schema.sql`.
3. Em Authentication > Users, crie o primeiro usuário administrador com seu e-mail e senha forte. Execute o trecho comentado ao final de `schema.sql`, preenchendo seu e-mail, para conceder o perfil `admin`.
4. Importe este repositório na Vercel, Framework Preset **Other**, pasta raiz `/`. O `vercel.json` configura build, arquivos públicos e API.
5. Configure somente no servidor da Vercel (Production e Preview): `SUPABASE_URL`, `SUPABASE_ANON_KEY` (chave anon legada), `SUPABASE_SERVICE_ROLE_KEY` (chave service_role legada). Nunca cole a chave administrativa no HTML, no GitHub ou numa conversa.
6. Em Supabase Authentication > URL Configuration, configure **Site URL** com a URL da Vercel. A recuperação de senha retorna a essa URL. Configure SMTP de produção e os limites/proteção contra abuso do Supabase Auth antes de liberar a equipe.
7. Faça o deploy. Entre com seu usuário, abra Equipe e Usuários para cadastrar acessos. Gabi, Laura, Emanuel e Lucas começam com carteiras vazias e comissão de 60%.

## Permissões e sincronização

- Administrador: visualiza e edita toda a carteira, equipe, comissões e acessos.
- Colaborador: o servidor entrega somente sua carteira; não entrega clientes, contas ou comissões de outros colaboradores. O servidor bloqueia transferências para outra carteira e alterações na configuração de comissões.
- As tabelas têm RLS ativada e acesso direto bloqueado para usuários públicos/autenticados. Somente a API usa a chave administrativa. Não é suficiente esconder botões para proteger os dados.
- Dados compartilhados atualizam a cada 15 segundos quando não há formulário aberto nem gravação em andamento.
- Gravações usam versão e atualização condicional atômica: duas pessoas não sobrescrevem silenciosamente o trabalho uma da outra. Em falha/conflito, a alteração não salva é baixada como JSON, e a tela volta à última versão confirmada.
- Sessões usam cookies HttpOnly, Secure e SameSite. O logout revoga a sessão. Remover o perfil revoga acesso imediatamente mesmo que um token ainda exista.

## Limites desta versão

Mantém a interface e os cálculos recebidos no ZIP; não constitui auditoria dos cálculos financeiros. O estado comercial é armazenado em um documento JSON transacional, limitado a 2 MB por gravação, até 5.000 clientes. Pode ser posteriormente normalizado em tabelas por entidade. A edição de permissões é administrativa. Não importa automaticamente dados de navegadores antigos nem suas senhas. Se houver dados reais na versão antiga, preserve uma exportação antes de migrar e faça a importação de forma controlada. Configure backups no Supabase.

Sem as variáveis, migração SQL e primeiro administrador, o sistema mostra que o banco ainda não foi configurado. Não ativa um modo local de demonstração automaticamente.

## Verificação

`npm test` executa testes de autorização, isolamento das carteiras, validação e concorrência simulada. `npm run build` prepara os arquivos estáticos. A verificação com banco e contas reais deve ser feita após a conexão: crie cliente como Gabi, confirme que aparece para o administrador em outro navegador e que Laura não consegue consultá-lo; registre um pagamento e confirme persistência após sair/entrar; simule edições simultâneas.
