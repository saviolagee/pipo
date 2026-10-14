// Servidores MCP que já vêm conhecidos pelo app: qualquer Pipo pode adicionar com um clique de
// confirmação. Nada é baixado nem roda antes de o usuário aceitar.

export interface McpPreset {
  /** Nome do servidor no mcp.json do Pipo (o "server" do passo `mcp`). */
  name: string;
  title: string;
  about: string;
  command: string;
  args: string[];
  /** O que precisa existir na máquina para funcionar. */
  needs: string;
  source: string;
}

export const MCP_PRESETS: McpPreset[] = [
  {
    name: 'rea',
    title: 'REA',
    about: 'Engenharia reversa com agentes: analisa apps, sites, APKs, firmware e binários sem o código-fonte.',
    command: 'npx',
    // Versão fixa, como a documentação do REA pede para registros permanentes.
    args: ['-y', 'rea-agents@6.4.0', 'mcp'],
    needs: 'Node.js 22.19 ou mais novo (ou 24.11+). Para binários nativos, Ghidra, Hopper ou IDA instalados; para APKs, JADX com um JDK; para sites, um navegador da família Chrome.',
    source: 'https://github.com/morluto/rea (MIT)',
  },
];

export function mcpPreset(name: string): McpPreset | null {
  return MCP_PRESETS.find((p) => p.name === name.trim().toLowerCase()) ?? null;
}
