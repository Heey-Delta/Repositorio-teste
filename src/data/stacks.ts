// Tecnologias mostradas na seção "Stacks". Edite à vontade: cada grupo vira uma coluna.
export interface StackGroup { group: string; items: string[]; }

export const stacks: StackGroup[] = [
  { group: 'Base da web', items: ['HTML', 'CSS', 'JavaScript'] },
  { group: 'Frameworks e estilo', items: ['Astro', 'Tailwind CSS'] },
  { group: '3D e gráficos', items: ['Three.js', 'WebGL'] },
  { group: 'Ferramentas', items: ['Git e GitHub', 'Node.js', 'npm'] },
];
