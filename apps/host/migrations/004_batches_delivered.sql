-- Lotes de impresión: entrega del lote completo.
ALTER TABLE print_batches ADD COLUMN delivered_at TEXT;
ALTER TABLE print_batches ADD COLUMN delivered_by TEXT;
