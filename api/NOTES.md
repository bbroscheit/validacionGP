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

## `AWLI_IMPUESTOS` - detalle impositivo real por comprobante ✅ confirmado

Tabla clave para todo lo que necesite el desglose de IVA por comprobante (gravado vs.
no gravado/exento, percepciones, etc.) - no está en SOP30200/PM30200, vive acá. Una fila
por cada línea de impuesto que GP calculó al facturar/registrar la compra.

- `TYPE = 2` → ventas. `VCHRNMBR` es directamente el `SOPNUMBE` (sin transformar).
- `TYPE = 1` → compras. `VCHRNMBR` es el voucher interno de GP, no el `DOCNUMBR` - hay
  que resolverlo primero contra `PM30200`/`PM20000` por `DOCNUMBR`+`VENDORID`.
- `TAXDTLID` identifica el tipo de línea:
  - Ventas: `IVADF <tasa>%` (ej. `IVADF 21%`) = gravado; `IVADF 21% CF` = mismo 21%
    pero para Factura B/C (nunca coexiste con `IVADF 21%` en el mismo comprobante,
    se puede sumar como la misma tasa sin duplicar); `IVADF 0% EXE` = exento;
    `IB-PV-B-A`/`IB-PV-C-F` = percepción IIBB (alternativas por jurisdicción, solo
    una da un importe ≠ 0 por comprobante).
  - Compras: mismo esquema con prefijo `IVACF` (`IVACF 0% NOGRAV` existe además de
    `IVACF 0% EXE` - son conceptos distintos, no mezclar), percepciones `IB-PC-*`,
    retenciones IVA `IVA-PC-RG3337 *`, y `SIRCREB` (impuesto a los créditos y
    débitos bancarios, no es un concepto de IVA).
- **`TAXDTAMT` vs `TDTTXAMT`**: en la enorme mayoría de los casos son iguales, pero no
  siempre (confirmado 41 filas distintas en toda la tabla al momento de este check).
  Cuando difieren, `TDTTXAMT` es el que realmente reconcilia contra el importe total
  del comprobante (`DOCAMNT`) - usar siempre `TDTTXAMT` como base imponible, no
  `TAXDTAMT`. Validado sumando todas las líneas de cada comprobante de julio/2026
  (1333 ventas + 307 compras) contra su `DOCAMNT`: diferencia $0 en ventas, ~$0,01
  en compras (redondeo).
- Percepciones/retenciones (`IB-*`, `IVA-PC-RG3337*`) reusan la misma base que la
  línea de IVA gravado correspondiente - no sumarlas como base adicional, solo tomar
  su `TAXAMNT` (el importe de la percepción en sí).

Usado para separar "RI (Gravado)"/"RI (No Gravado)" en compras-categoria-contribuyente
y para armar el Libro IVA Digital (ver `api/src/services/libroIvaDigital*.js`).
