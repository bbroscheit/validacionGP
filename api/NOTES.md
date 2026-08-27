# Esquema de GP confirmado contra PRD08 (Ecobahia)

Los 4 endpoints se probaron contra la base real (`SQL2-BA\GP` / `PRD08`, vía WireGuard).
Esto es lo que quedó confirmado y lo que sigue abierto.

## Endpoint 1 - Ventas (`SOP30200`/`SOP30300`) ✅ confirmado

- Sucursal = `LOCNCODE` (ej. `"PRINCIPAL"`). Funciona bien como filtro.
- Fecha = `DOCDATE`.
- **Provincia**: la columna `STATE` existe en el header de `SOP30200`, pero en los
  registros probados aparece **vacía** (solo espacios). `CITY` sí viene cargado.
  Es decir: el campo "está donde pensábamos" a nivel esquema, pero en la práctica
  no parece estar siendo completado — antes de construir algo sobre esto, revisar
  con más clientes/sucursales si `STATE` realmente se usa en algún caso.

## Endpoint 2 - Compras (`PM10000`/`PM30200`) ✅ confirmado

- `DOCTYPE = 1` filtra correctamente solo facturas. Probado con datos reales de
  agosto 2026 (1 fila en work, 47 en history), todas con `DOCTYPE: 1`.

## Endpoint 3 - Gastos (GL) ✅ confirmado (con correcciones)

Supuestos iniciales que estaban MAL y se corrigieron:
- `GL00100` **no tiene** `ACTNUMST` (el número de cuenta ahí está partido en
  `ACTNUMBR_1`..`ACTNUMBR_10`). El string armado vive en `GL00105` (lookup que
  GP mantiene aparte), que se une por `ACTINDX` igual que `GL00100`.
- El campo de descripción en `GL20000` es `DSCRIPTN`, no `TRXDSCRN`.

Confirmado:
- Cuentas de gastos = `GL00100.ACCATNUM = 16` (categoría de cuenta). El rango de
  cuentas de gasto real arranca en `651100-01-000` (formato `NNNNNN-NN-NNN`).
- `SOURCDOC` sí distingue el origen del movimiento. Valores reales vistos en 2026:
  `SJ` (ventas), `CRJ`, `PMTRX`/`PMPAY`/`PMVPY`/`PMVVR` (compras/pagos), `DG`
  (asientos manuales/generales), `RMJ`. **No existe** `GLTRX` en esta instalación
  (ese nombre es el genérico de GP en inglés, acá está localizado distinto).

## Endpoint 4 - OPB (`GL20000`) ⚠️ sin resolver

Se buscó "OPB" / "ORDEN" / "VARIA" en `REFRENCE` y `DSCRIPTN` de **todo GL20000
2026** y no apareció nada. Los `SOURCDOC = 'DG'` (el único tipo que parece asiento
manual/general) que se revisaron son transferencias bancarias y reclasificaciones
de IVA — no algo identificable como orden de pago varia sin factura.

Decisión: no se hardcodea ningún filtro por defecto. El endpoint queda con
`sourcdoc` y `referencia` como filtros opcionales (sin valor por defecto) para ir
probando cuando se sepa el criterio real. Pistas para seguir:
- Preguntarle a alguien de contaduría/GP cómo se cargan las OPB (¿cuenta contable
  específica? ¿prefijo de comprobante en Payables?).
- Si se consigue un ejemplo concreto (fecha + monto, o número de comprobante) de
  una OPB real, se puede buscar directamente en los datos para encontrar el patrón.
