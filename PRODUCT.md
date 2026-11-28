# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Confirmado con el usuario (28/11/2026). Cuatro grupos, todos internos de Subatir S.A. / Prolimpio:

- **Compras, en PC (grupo principal).** El equipo de compras, con perfil admin. Pasa muchas horas por día en la app con pantalla grande: arma pedidos y órdenes de compra, sigue entregas, mantiene precios y proveedores, prevé importaciones, reposición y la temporada de cloro, y saca informes. Trabaja sobre tablas largas y cruza módulos.
- **Operarios de recepción.** Reciben la mercadería, cargan entregas parciales, lote, COA y el check list PL-06. Ven uno o dos módulos (Recepción, a veces Solicitar).
- **Depósito, en celular.** Personal de Furriol y Artigas usa Recorrido y Solicitar: pide pallets, prepara y despacha traslados, escanea QR. De pie, con una mano, a veces con mala señal.
- **Calidad y producción.** Consultan fichas técnicas, hojas de seguridad y COA por materia prima y proveedor en Calidad MP. Producción también pide mercadería.

## Product Purpose

Sistema de gestión de compras y stock que reemplazó a las planillas de Google Sheets. Hay una sola base en la nube (Supabase) y cada número se calcula en un solo lugar, así que todos los módulos dicen lo mismo. Cubre el circuito completo: pedir, recibir, guardar, mover entre depósitos, prever y reportar.

Éxito: el equipo resuelve su trabajo diario sin volver a la planilla, sin pedir datos por WhatsApp y sin desconfiar de lo que muestra la pantalla.

## Positioning

Está hecho a medida de cómo trabajan Subatir y Prolimpio: sus depósitos (Furriol → Artigas, donde termina la trazabilidad por pallet), sus tipos de mercadería (Consumo, Venta, Infraestructura), la importación de MERO AR con su costeo, la temporada de cloro, el control de calidad por lote y COA, y las órdenes con su numeración y su PDF. Un sistema genérico de inventario no conoce ninguna de esas reglas.

## Operating Context

- Dos apps sobre la misma base: **Compras** (raíz: Dashboard, Pedidos, Recepción, Stock, Precios, Pedidos Varios, Proveedores, Previsión de Reposición, Importaciones, Previsión Cloro, Calidad MP, Informes, Usuarios) y **Control de Stock de Depósitos** (`deposito/`: panel, Recorrido y Solicitar para el celular).
- Permisos por perfil y por módulo. El menú muestra sólo lo que cada persona puede ver.
- Salidas en papel y archivo: PDF de órdenes de compra, Excel y CSV, impresión.
- Los cambios de datos o de esquema se hacen con archivos SQL en `migracion/`, que corre el usuario.
- La app avisa sola cuando hay una versión nueva y se recarga. También se instala como app (PWA).

## Capabilities and Constraints

- HTML, CSS y JS estáticos, sin paso de compilación. Se publica en GitHub Pages desde `main`. Todo lo que está en el repositorio queda público.
- Toda escritura va directo a Supabase: nada de guardado local ni de "sincronizar". localStorage sólo para preferencias del equipo (tema, vistas).
- Pruebas automáticas con `npm test` (node, sin dependencias).
- Los cálculos compartidos viven en archivos `*-calc.js`. Un número se calcula en un solo lugar.
- Tres modos de color: oscuro (el de siempre), claro y gris, en `tema.js`.
- Español rioplatense en toda la interfaz. Monedas U$S y $ (pesos uruguayos), que nunca se suman entre sí.

## Brand Commitments

Confirmado: la 2.0 **refina** la identidad actual y no la reemplaza.

- Subatir S.A. / Prolimpio: logo e íconos de la app (`logo.jpg`, `logo-prolimpio.jpg`, `icon-*.png`).
- Estilo obligatorio (CLAUDE.md): premium corporativo; fondo oscuro con gradientes negro y azul petróleo y detalles naranja; glassmorphism con tarjetas de bordes suaves y sombras elegantes; tablas compactas, filtros visibles y KPIs arriba. Nada básico ni genérico.
- Modos claro y gris como alternativas elegidas por cada persona. Oscuro es el predeterminado.

## Evidence on Hand

- Datos reales de producción en Supabase: órdenes de compra, inventario, pallets, traslados, precios, proveedores.
- Documentación de calidad (FT, HDS, COA) cargada por materia prima y proveedor.
- No hay testimonios, métricas de uso ni benchmarks. No inventarlos.

## Product Principles

1. **El trabajo diario manda.** Ver lo importante primero, menos clics, tablas que se leen de un vistazo. Lo que no ayuda a decidir o a actuar, se va (por eso se sacaron del Dashboard la Cobertura, el Stock Crítico y la Reposición: viven en Stock).
2. **Un número, un solo lugar.** La pantalla nunca se contradice entre módulos.
3. **Parejo y profesional en toda la app.** Mismo vocabulario visual en cada módulo y en las dos apps: si un botón se ve distinto en dos pantallas, uno está mal.
4. **No perder datos al compactar.** Más denso no significa esconder: nada se corta con "…" si es información de trabajo.
5. **Decir la verdad sobre el estado.** "No pude revisar" no es "no hay nada", y un guardado que la base rechazó no se muestra como guardado.

## Accessibility & Inclusion

Uso en celular en el depósito: botones grandes, una mano, mala señal. Sin otra norma formal confirmada.
