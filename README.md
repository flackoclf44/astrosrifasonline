# ASTROS — Versão para GitHub Pages (somente site estático)

Esta versão é feita exclusivamente para **GitHub Pages**. Ela exibe a marca e fotos, os 150 números e o valor **R$ 2,50** e permite simular seleções **somente no navegador**. Não há backend, cadastro, autenticação, banco de dados, Pix, reservas, confirmação de pagamento nem vendas.

## Como publicar — Github Pages

1. Extraia o arquivo ZIP. Abra a pasta `ASTROS_GitHub_Pages`.
2. Crie no GitHub um repositório **público** chamado `astros-site` (o GitHub Free exige repositório público para Pages).
3. No repositório, selecione **Add file → Upload files** e envie o **conteúdo de dentro** dessa pasta: `index.html`, `app.js`, `styles.css`, `legal.css`, `assets/`, `regulamento.html`, `privacidade.html`. Não deixe tudo dentro de uma pasta a mais.
4. Clique em **Commit changes**.
5. Vá em **Settings → Pages**. Em **Build and deployment**, escolha **Source: Deploy from a branch**.
6. Escolha a branch `main`, pasta `/(root)`, e **Save**.
7. Depois que a publicação terminar, seu site aparecerá em `https://SEU-USUARIO.github.io/astros-site/`.

**Caso seu repositório já contenha `server.js`, `package.json` e uma pasta `public/`:** envie os arquivos desta edição estática para a *raiz* do repositório, e configure o Pages para `/(root)`. Os arquivos adicionais do servidor não funcionarão no GitHub Pages e não são necessários para a edição estática. Evite publicar credenciais, `.env`, dados privados ou arquivos administrativos.

**Importante:** a versão comercial com reservas e Pix exige serviço de backend e pagamentos externo. GitHub Pages não permite implementar essas funções com segurança apenas com arquivos estáticos. A modalidade e a documentação de autorização da campanha devem ser verificadas antes de receber dinheiro.
