<div align="center">
  <img src="assets/icon.png" alt="TraceVis Logo" width="120" />

  <h1>🌐 TraceVis</h1>
  <p><b>Visual Traceroute & Network Intelligence Dashboard</b></p>

  <p>
    <a href="https://github.com/JP-Redes/TraceVis/releases/latest"><img src="https://img.shields.io/github/v/release/JP-Redes/TraceVis?style=for-the-badge&color=00d4ff" alt="Latest Release"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge" alt="License MIT"></a>
    <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-3b82f6?style=for-the-badge" alt="Supported Platforms">
    <img src="https://img.shields.io/badge/Built%20with-Tauri%20%2B%20Rust-orange?style=for-the-badge" alt="Built with Tauri + Rust">
  </p>
</div>

---

## 📖 Sobre o Projeto

O **TraceVis** é uma ferramenta de diagnóstico de rede que transforma o `traceroute` tradicional em uma experiência visual rica e interativa. Ele mapeia geograficamente cada salto (hop) dos seus pacotes em tempo real — com dados de geolocalização, ASN, ISP, RTT e resolução DNS reversa.

> **v2.0 — Reescrito do zero com Tauri + Rust.**
> O núcleo do aplicativo foi migrado de Electron para [Tauri](https://tauri.app/), resultando em um binário nativo muito menor, menor consumo de memória e melhor desempenho geral. O motor de traceroute agora roda inteiramente em Rust, com parsing robusto para Windows, macOS e Linux.

---

## ✨ Funcionalidades

* **🗺️ Mapeamento em Tempo Real** — Visualize a rota dos pacotes em um mapa interativo com arcos geodésicos animados entre os saltos
* **📊 Painel de Análise Completo** — RTT por salto, gráfico de perfil de latência, perda de pacotes, países atravessados e detalhes de ISP/ASN
* **🔍 Resolução DNS Reversa** — Hostnames resolvidos via Cloudflare DNS-over-HTTPS (sem dependência de ferramentas do sistema)
* **🌗 Modo Escuro e Claro** — Temas com tiles de mapa correspondentes (CartoDB Dark / Light)
* **🌍 IPv4 e IPv6** — Detecção automática e suporte completo, incluindo identificação de redes privadas e CGNAT
* **🇧🇷 Multilíngue** — Interface em Inglês e Português
* **📋 Exportação** — Relatório em texto, JSON estruturado e CSV para todos os saltos
* **⌨️ Atalhos de Teclado** — Navegação completa sem mouse
* **🕐 Histórico de Rastreamentos** — Acesso rápido aos últimos 12 destinos pesquisados

---

## 📸 Interface

<div align="center">
  <img src="assets/screenshot-dark.png" alt="TraceVis Dark Theme" width="48%">
  <img src="assets/screenshot-light.png" alt="TraceVis Light Theme" width="48%">
</div>

---

## 🚀 Como Baixar e Usar

Baixe a versão compilada para o seu sistema na página de [Releases](../../releases):

| Sistema | Arquivo |
|---|---|
| **Windows** | `.exe` (instalador NSIS) |
| **macOS Intel** | `.dmg` (x64) |
| **macOS Apple Silicon** | `.dmg` (arm64) |
| **Linux** | `.AppImage` ou `.deb` |

> **macOS:** Como o app não possui assinatura paga da Apple, o Gatekeeper pode bloquear na primeira abertura. Clique com o botão direito no `.dmg` e selecione **Abrir** para contornar.

> **Linux:** O traceroute requer privilégio de rede. Veja a seção de [Solução de Problemas](#️-solução-de-problemas) abaixo.

---

## 🛠️ Para Desenvolvedores

### Pré-requisitos

* [Node.js](https://nodejs.org/) 18 LTS ou superior
* [Rust](https://rustup.rs/) (toolchain estável)
* Dependências do sistema para Tauri:
  * **Linux:** `sudo apt install libwebkit2gtk-4.0-dev build-essential curl wget libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`
  * **macOS:** Xcode Command Line Tools (`xcode-select --install`)
  * **Windows:** Microsoft C++ Build Tools (Visual Studio) + WebView2

### Instalação

```bash
git clone https://github.com/JP-Redes/TraceVis.git
cd TraceVis
npm install
```

### Execução em modo desenvolvimento

```bash
npm run dev
```

### Build de produção

```bash
npm run build
```

O Tauri detecta automaticamente a plataforma e arquitetura. O artefato gerado fica em `src-tauri/target/release/bundle/`.

Para um build com símbolos de debug (útil para diagnóstico):

```bash
npm run build:debug
```

---

## ⚠️ Solução de Problemas

**`tracert` não encontrado (Windows)**
Execute o aplicativo como Administrador.

**O mapa não mostra os saltos (Linux)**
O `traceroute` precisa de permissão de rede raw. Conceda com:
```bash
sudo setcap cap_net_raw+ep $(which traceroute)
```

**`traceroute: command not found` (Linux)**
Instale o pacote correspondente à sua distro:
```bash
# Ubuntu / Debian
sudo apt install traceroute

# Fedora / RHEL
sudo dnf install traceroute

# Arch Linux
sudo pacman -S traceroute
```

**`traceroute6: command not found` (macOS, para IPv6)**
```bash
brew install inetutils
```

**App não abre (macOS — "desenvolvedor não verificado")**
Clique com o botão direito no `.dmg` → **Abrir** → confirme na caixa de diálogo.

---

## 💻 Stack de Tecnologias

| Camada | Tecnologia |
|---|---|
| Interface | HTML5, CSS3, JavaScript Vanilla |
| Motor desktop | [Tauri 1](https://tauri.app/) |
| Backend / traceroute | Rust (tokio, reqwest, serde) |
| Mapas | [Leaflet.js](https://leafletjs.com/) |
| Geolocalização | [ip-api.com](https://ip-api.com/) |
| DNS reverso | Cloudflare DNS-over-HTTPS |
| Fontes | Syne & JetBrains Mono |

---

## 📜 Licença

Este projeto está sob a licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.

<div align="center">
  <br/>
  <p>Desenvolvido com dedicação por <b>João Pedro</b>.</p>
</div>
