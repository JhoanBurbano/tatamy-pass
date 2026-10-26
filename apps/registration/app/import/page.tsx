import { redirect } from 'next/navigation';

/** La importación vive ahora en el panel (con historial de lotes). */
export default function ImportRedirect() {
  redirect('/panel/importar');
}
