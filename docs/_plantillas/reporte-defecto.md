# Plantilla · Reporte de defecto

> Registrar como issue con la etiqueta `defecto` y el ID `DEF-nnn`. Es la misma plantilla de [20-RF-TEST §9](../20-RF-TEST.md), en formato para copiar. Regla: un P1 encontrado en el simulacro se corrige y se re-verifica con el **mismo TC** antes de D−2; si no, el ítem del go/no-go queda en rojo.

```
DEF-nnn · <título corto en una línea>

Severidad:      P1 bloqueante / P2 alta / P3 media
Módulo:         inscripción | sportdata | emisión | impresión | scanner | host | antifraude | roles | enrolamiento | auditoría | backups | digital | nube | panel
RF afectado:    RF-xxx
TC que falló:   TC-xxx (paso N)
Entorno:        DEV | LAB | SIM | PROD · versión/commit · dispositivo (modelo, SO, navegador) · con red / sin red
Fecha y hora:   AAAA-MM-DD HH:MM · quien lo encontró

Precondiciones:
  <estado inicial exacto: credencial, zona, modo, dispositivos, host primario o respaldo>

Pasos para reproducir:
  1.
  2.
  3.

Resultado obtenido:
  <qué pasó; adjuntar captura, log del scanner (menú ⋯ › Diagnóstico), extracto de GET /audit, salida de docker compose logs>

Resultado esperado:
  <según el criterio de aceptación del RF, citando el texto exacto del catálogo de docs/70 si es un mensaje>

Impacto en el evento:
  <qué pasaría en una puerta real si no se corrige>

Reproducible:   siempre / a veces (N de M) / una vez
Workaround:     <si existe, para operación — se añade a 50 §11 si es útil el día D>
Asignado a:
Estado:         nuevo → confirmado → en corrección → corregido → verificado (TC re-ejecutado en <fecha>) → cerrado
```

## Para quien corrige

- [ ] Test que reproduce el defecto (unitario, integración o spec e2e nombrada por el TC) **antes** de corregir.
- [ ] Corrección + test en verde + `npm run check`.
- [ ] Entrada en `docs/99-CHANGELOG.md` bajo **Corregido**.
- [ ] Si cambió un texto visible: `docs/70-UX-WRITING.md`.
- [ ] Re-verificación del TC en el entorno donde falló; anotar fecha en el issue.
