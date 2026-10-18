// Sem modo foco: tarefa que ficou "fazendo" (foco interrompido) volta a ser só uma tarefa aberta.
export default `
UPDATE tasks SET status = 'todo' WHERE status = 'doing';
`;
