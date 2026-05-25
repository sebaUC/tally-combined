# Informe de Viabilidad: Tarjeta Prepago Tally Finance

**Preparado por:** Sebastian Derpsch, CTO  
**Fecha:** 6 de abril de 2026  
**Para:** Reunion estrategica del 13 de abril de 2026  
**Clasificacion:** Confidencial — Equipo Fundador

---

## Indice

1. [Contexto y Objetivo](#1-contexto-y-objetivo)
2. [Marco Regulatorio en Chile](#2-marco-regulatorio-en-chile)
3. [Menores de Edad: Restricciones Legales](#3-menores-de-edad-restricciones-legales)
4. [Proteccion de Datos (Ley 21.719)](#4-proteccion-de-datos-ley-21719)
5. [Proveedores BaaS: Benchmark](#5-proveedores-baas-benchmark)
6. [Caso Fintual: Leccion del Mercado](#6-caso-fintual-leccion-del-mercado)
7. [Estado de la Industria Prepago en Chile](#7-estado-de-la-industria-prepago-en-chile)
8. [Modelo Qapital: Referencia de Negocio](#8-modelo-qapital-referencia-de-negocio)
9. [Analisis de Modelos de Ingreso](#9-analisis-de-modelos-de-ingreso)
10. [Mercado de Venta de Datos (Data Insights)](#10-mercado-de-venta-de-datos)
11. [Opinion del CTO](#11-opinion-del-cto)
12. [Fuentes](#12-fuentes)

---

## 1. Contexto y Objetivo

El libro blanco "Plan Maestro de Disrupcion Financiera" presentado por Jose Tomas Arevalo (CEO) propone un pivot fundamental de Tally Finance: pasar de un chatbot de registro manual de gastos a un **ecosistema fintech con tarjeta prepago Visa/Mastercard**, integrada con una app de educacion financiera y gamificacion, dirigido a estudiantes universitarios y de colegios en Chile bajo un modelo B2B2C.

Este informe evalua la viabilidad tecnica, regulatoria, financiera y comercial de esa propuesta. Cada afirmacion esta respaldada por datos verificados de fuentes publicas, reguladores oficiales y datos de mercado.

---

## 2. Marco Regulatorio en Chile

### 2.1 Emision de Tarjetas Prepago

En Chile, **toda emision de tarjetas prepago requiere que el emisor este registrado en la CMF** (Comision para el Mercado Financiero) bajo la Ley 20.950 (2016). No existe camino legal para que una entidad no regulada emita tarjetas directamente.

**Opciones para Tally:**

| Camino | Requisitos | Timeline | Capital Minimo |
|--------|-----------|----------|---------------|
| **Program Manager (bajo BaaS)** | Operar bajo licencia de Pomelo/Dock | 3-6 meses integracion | Sin capital regulatorio propio |
| **Emisor Directo** | Constituir SA Especial + registro CMF | 18-36 meses | 10.000 UF (~CLP 370M / ~USD 400K) |

**Precedentes de timeline real de licenciamiento:**

| Empresa | Inicio | Autorizacion CMF | Duracion |
|---------|--------|-----------------|----------|
| MetroPago (Metro + Pomelo) | 2019 | Junio 2025 | ~6 anos |
| Mercado Pago | ~2019 | Nov 2021 | ~2 anos |
| Fintual Prepago | — | Nov 2024 | No divulgado |

**Conclusion:** El camino de emisor directo es inviable para una startup pre-seed. La unica opcion realista es operar como Program Manager bajo un BaaS ya licenciado, lo cual aun requiere 3-6 meses de integracion tecnica.

### 2.2 Ley Fintec (21.521)

Tally **no cae en ninguna de las 7 categorias** de prestador regulado por la Ley Fintec (crowdfunding, sistemas de transaccion, intermediacion, etc.). La emision de prepago se regula separadamente por la Ley 20.950.

Sin embargo, si Tally quisiera actuar como IPI (Institucion Proveedora de Informacion) en el Sistema de Finanzas Abiertas, o si el modelo de data insights se interpreta como asesoria, podria requerir inscripcion adicional.

### 2.3 Sistema de Finanzas Abiertas (SFA)

- Regulado por NCG 514 de la CMF
- **Entrada en vigencia aplazada a julio 2027** (era julio 2026)
- No es bloqueante inmediato para operar
- Cuando entre en vigencia, todos los bancos deberan exponer APIs estandarizadas para compartir datos financieros con consentimiento del usuario

### 2.4 Sanciones por Operar sin Registro

| Infraccion | Sancion |
|-----------|---------|
| Operar servicios financieros regulados sin registro | Multas hasta 15.000 UTM (~CLP 990M) |
| Emision de prepago sin autorizacion CMF (Ley 20.950) | Sanciones potencialmente mas graves |

---

## 3. Menores de Edad: Restricciones Legales

### 3.1 Capacidad Legal (Codigo Civil)

| Rango de Edad | Estatus | Puede Contratar Servicios Financieros? |
|---------------|---------|---------------------------------------|
| Menores de 12 (mujeres) / 14 (hombres) | **Absolutamente incapaces** (impuberes) | **NO.** Actos son nulos de pleno derecho. No pueden ser titulares de tarjeta bajo ninguna circunstancia. |
| 12-17 (mujeres) / 14-17 (hombres) | **Relativamente incapaces** (menores adultos) | Si, con autorizacion del representante legal. Sin ella, el contrato tiene nulidad relativa. |
| 18+ | Plenamente capaces | Si, sin restricciones. |

### 3.2 Precedentes de Tarjetas para Menores en Chile

| Producto | Emisor | Edad Minima | Autorizacion Parental |
|----------|--------|-------------|----------------------|
| CuentaRUT | BancoEstado | 12(M)/14(H) | Si, presencial |
| Tu MACH | BCI | 14 | Si, via app del tutor |
| Teenpo | Tenpo | 14 | Si, tutor con cuenta Tenpo |

**Es legalmente posible ofrecer tarjetas prepago desde los 14 anos** con consentimiento parental verificable. Sin embargo, ninguna fintech ha implementado un modelo B2B2C entrando por colegios — todos operan directo al consumidor.

### 3.3 Riesgos Especificos de Operar en Colegios

| Riesgo | Severidad | Detalle |
|--------|-----------|---------|
| Nulidad de contratos | Alta | Si un menor firma sin autorizacion parental valida, el contrato es anulable |
| Audiencia cautiva | Alta | Ofrecer productos financieros en un colegio podria interpretarse como practica comercial agresiva. SERNAC podria actuar de oficio |
| Responsabilidad del colegio | Alta | Podria ser considerado co-responsable. Muchos colegios rechazaran por riesgo reputacional |
| Superintendencia de Educacion | Media | Podria cuestionar comercializacion de productos financieros en establecimientos educacionales |
| Padres organizados | Alta | Reclamo colectivo ante SERNAC si perciben que el colegio "vende datos de sus hijos" |
| Gamificacion con menores | Media-Alta | Mecanismos RPG podrian ser cuestionados como manipulacion psicologica |

### 3.4 Embajadores Estudiantiles en Colegios

- Menores de 15 anos: **NO pueden trabajar** bajo ninguna circunstancia (Codigo del Trabajo Art. 13)
- 15-17 anos: Pueden trabajar con autorizacion parental escrita, max 30 hrs/semana, solo trabajos livianos
- **Recomendacion:** No usar estudiantes de colegios como embajadores

### 3.5 Semaforo Regulatorio

| Area | Estado |
|------|--------|
| Tarjeta a universitarios (18+) | **VERDE** — Sin barreras especiales |
| Tarjeta a menores 14-17 (colegios) | **AMARILLO** — Posible con consentimiento parental robusto |
| Tarjeta a menores <14 | **ROJO** — Absolutamente incapaces, imposible |
| Embajadores en colegios (<15) | **ROJO** — Ilegal |
| Data insights de menores | **ROJO** — Riesgo legal y reputacional extremo |

---

## 4. Proteccion de Datos (Ley 21.719)

### 4.1 Entrada en Vigencia

La Ley 21.719 (nueva ley de proteccion de datos personales) entra en vigencia el **1 de diciembre de 2026** — 8 meses desde la fecha de este informe. Todo lo que Tally diseñe debe cumplir con esta ley desde el dia uno.

### 4.2 Reglas para Menores

| Grupo | Consentimiento |
|-------|---------------|
| Menores de 14 | Del menor NO tiene valor legal. Solo padres/tutores. Debe ser informado, especifico y verificable |
| 14-15 | Datos sensibles requieren padres |
| 16-17 | Mayor autonomia progresiva, pero la ley es conservadora |
| 18+ | Consentimiento propio |

**Principio rector:** El interes superior del nino debe prevalecer en cualquier tratamiento de datos de menores.

### 4.3 Anonimizacion y K-Anonymity

La ley define anonimizacion como un **"procedimiento irreversible"**. K-Anonymity sola **probablemente no cumple** con esta definicion, ya que es vulnerable a ataques de homogeneidad y conocimiento previo. Se requeriria complementar con differential privacy, l-diversity o t-closeness.

La carga de la prueba de irreversibilidad recae en Tally.

### 4.4 Sanciones

| Tipo | Multa Maxima |
|------|-------------|
| Leve | 5.000 UTM (~USD 350K) |
| Grave | 10.000 UTM (~USD 700K) |
| Gravisima | 20.000 UTM (~USD 1,4M) |
| Reincidencia | Hasta 2-4% de ingresos anuales |

La ley crea la **Agencia de Proteccion de Datos Personales**, con facultades de supervision, regulacion y sancion.

---

## 5. Proveedores BaaS: Benchmark

### 5.1 Emisores No Bancarios Autorizados por la CMF (vigentes)

| Emisor | Marca Comercial | Red |
|--------|----------------|-----|
| Digital Payments Prepago S.A. | Mercado Pago | Mastercard |
| Tenpo Payments S.A. | Tenpo | Mastercard |
| Global Card S.A. | Global66 | Mastercard |
| Los Andes Tarjetas de Prepago S.A. | Prepago Los Heroes | — |
| Fintual Prepago S.A. | Fintual (no emite aun) | — |
| MetroPago S.A. | MetroPago | Pomelo |
| Copec Prepago S.A. | Copec Pay | Mastercard |

### 5.2 Proveedores BaaS Evaluados

**Los precios exactos de Pomelo, Dock y Galileo no son publicos.** Todos operan con pricing custom segun volumen. Las cifras del libro blanco son estimaciones no confirmadas.

| Dimension | Pomelo | Dock | Galileo |
|-----------|--------|------|---------|
| Origen | Argentina | Brasil | EE.UU. (SoFi) |
| Opera en Chile | Si | Si | Si |
| Caso exitoso Chile | MetroPago, MachBank | No publico | No publico |
| Licencia propia CMF | En tramite | No | No |
| Clientes LatAm | ~150 (Santander, BBVA, Rappi) | Masivo (+100M tarjetas) | Masivo (SoFi, Chime) |
| Funding | USD 160M | USD 110M+ (unicornio) | Subsidiaria SoFi (NASDAQ) |
| Redes | Visa + Mastercard | Visa + Mastercard | Visa + Mastercard |
| Tipo cobro | Variable (por uso) | Fee fijo por tecnologia | Transaccional + plataforma |
| Setup estimado (libro blanco) | $12.000 USD | $15.000 USD | $20.000 USD |
| Fee mensual estimado | $1.500 USD | $2.000 USD | $2.500 USD |
| Tarjeta fisica estimada | $3.800 CLP | $4.200 CLP | $4.500 CLP |

**Nota:** Estas cifras son las estimaciones del libro blanco. Los precios reales requieren contacto comercial directo con cada proveedor.

### 5.3 Costos Operacionales Estimados (con Pomelo, 100 usuarios)

**Setup unico:**

| Concepto | Costo |
|----------|-------|
| Integracion Pomelo | $10.000 - $15.000 USD |
| Constitucion SpA | $500.000 - $1.000.000 CLP |
| Diseño tarjeta | $500 - $2.000 USD |
| **Total setup** | **~$12.000 - $18.000 USD** |

**Por tarjeta emitida:**

| Concepto | Costo |
|----------|-------|
| Tarjeta fisica (plastico + chip) | $3.500 - $4.500 CLP |
| Envio al usuario | $2.000 - $5.000 CLP |
| KYC/verificacion | $0.30 - $1.00 USD |
| **Total por usuario (fisica)** | **$6.000 - $10.000 CLP** |

**Costos mensuales fijos:**

| Concepto | Costo/mes |
|----------|----------|
| Pomelo platform fee | $1.500 - $2.500 USD |
| Cloud infra | $100 - $300 USD |
| Legal/compliance | $300 - $500 USD |
| Herramientas | $50 - $100 USD |
| **Total fijo/mes** | **$2.000 - $3.500 USD** |

---

## 6. Caso Fintual: Leccion del Mercado

### 6.1 Que hicieron

En noviembre 2024, la CMF autorizo a **Fintual Prepago S.A.** como emisor no bancario (Resolucion Exenta N 10.164). Esto les permitio aparecer en la lista de bancos del pais y recibir depositos directos via CCA.

### 6.2 Que NO hicieron

Fintual **descarto lanzar la tarjeta.** Declaracion oficial:

> *"No es parte del plan de corto plazo. Seguimos enfocados en mejorar el producto en algo que es clave para nuestros clientes hoy: el movimiento del dinero para invertir en Fintual."*

### 6.3 Por que

1. **La licencia era un medio, no un fin.** El objetivo real era entrar a la CCA para recibir depositos directos, no emitir tarjetas.

2. **El foco esta en inversiones y AFP.** Fintual supero USD 1.200M en activos administrados, alcanzo breakeven en 2024, y esta evaluando crear una AFP. La tarjeta es una distraccion.

3. **El negocio de prepago no es rentable en Chile** (ver seccion 7).

4. **Competencia saturada.** Mercado Pago (69% market share), Tenpo, MACH, Global66, Prex — no hay espacio para otro plastico indiferenciado.

### 6.4 Que implica para Tally

Si Fintual — con USD 30M+ levantados, 150.000+ clientes, marca reconocida, y la licencia CMF ya obtenida — decidio que no vale la pena lanzar tarjeta, la señal es clara. Los recursos necesarios para operar una tarjeta se invierten mejor en el producto core.

---

## 7. Estado de la Industria Prepago en Chile

### 7.1 Crecimiento vs Rentabilidad

Las tarjetas prepago crecieron 103% en 2025, alcanzando 4.293.894 tarjetas con operaciones y montos por US$ 2.536 millones. Sin embargo, **este crecimiento no se traduce en rentabilidad**.

### 7.2 Resultados Financieros 2023 (todos los emisores no bancarios)

| Emisor | Tarjetas Vigentes | Perdida 2023 |
|--------|------------------|-------------|
| **Tenpo** | 1.500.000 | **-$16.039 millones CLP** (~USD -17M) |
| **Tapp** (Caja Los Andes) | 8.6% market share | **-$10.197 millones CLP** (~USD -10.8M) |
| **Caja Los Heroes** | — | **-$3.216 millones CLP** (~USD -3.4M) |
| **Copec Pay** | — | **-$1.837 millones CLP** (~USD -1.9M) |
| **Mercado Pago** | 4.100.000 | **-$1.262 millones CLP** (~USD -1.3M) |

**Fuente:** Diario Financiero, datos CMF. **Todos los emisores no bancarios cerraron 2023 con numeros rojos.** Ni siquiera Mercado Pago (con 4.1M de tarjetas y el ecosistema MercadoLibre detras) es rentable en prepago.

### 7.3 MACH Abandona el Prepago

En 2025-2026, MACH (Bci) — el player mas grande del prepago en Chile con millones de usuarios — **dejo de emitir tarjetas prepago** y migro a MachBank (cuenta corriente con tarjeta de debito). La migracion confirma que el modelo prepago puro no es sostenible ni siquiera para un banco grande.

### 7.4 Tenpo Cierra Producto Empresas

Tenpo cerro su producto Tenpo Business (tarjeta prepago para empresas) en abril 2024 por inviabilidad. En paralelo, busca licencia de neobanco (Tenpo Bank Chile) — reconociendo que el prepago solo no basta.

### 7.5 Tasa de Intercambio Regulada

El Comite Tecnico de Tasas de Intercambio fijo el **limite maximo en 0.80% para tarjetas prepago**. Este tope es regulado y no puede superarse.

| Tipo de Tarjeta | Tasa Maxima |
|----------------|-------------|
| Debito | 0.35% |
| Credito | 0.80% |
| **Prepago** | **0.80%** |

Ademas, existe un debate activo: ABIF (Asociacion de Bancos) disputa que las fintechs puedan captar fondos masivamente. Pedro Pineda (CEO Fintual) respondio publicamente: *"Lo relevante es lo que dice la ley, no la opinion de los bancos."* Este riesgo regulatorio es real y podria afectar a cualquier nuevo emisor.

### 7.6 Iupana: "Un Negocio Maniatado"

En abril 2025, el medio especializado IUPANA titulo: **"Tarjetas prepago en Chile: un negocio maniatado que pide cambios legales para lograr rentabilidad."** El articulo documenta que las fintechs prepago compiten contra la banca con reglas dispares y piden cambios normativos para mejorar su estrategia.

### 7.7 Nuevas Obligaciones Tributarias

Desde julio 2025, las tarjetas prepago deben reportar al SII (Servicio de Impuestos Internos) cuando un cliente recibe 50+ transferencias mensuales o excede 100 en seis meses. Esto agrega costo operacional y compliance adicional.

---

## 8. Modelo Qapital: Referencia de Negocio

### 8.1 Evolucion Historica

| Ano | Que hicieron | Tarjeta? |
|-----|-------------|----------|
| 2012 | Fundacion (George Friedman, Erik Akterin, NYC) | NO |
| 2013 | Lanzan en Suecia como dashboard financiero | NO |
| 2014 | Pivotan a app de ahorro automatico con reglas | NO |
| 2015 | Lanzan en EE.UU. Se conectan al banco del usuario via Plaid | NO |
| 2016 | Levantan $12M (Series A). 400.000 usuarios. Solo ahorro con reglas | NO |
| **2017** | **Lanzan tarjeta Visa Debit con Lincoln Savings Bank como BaaS** | **SI** |
| 2018 | Levantan $30M (Series B). Agregan inversiones. 2M usuarios | SI |

**Qapital valido el producto, consiguio 400.000 usuarios y levanto $12M ANTES de tener tarjeta.** La tarjeta llego 4 anos despues como expansion, no como punto de partida.

### 8.2 Como Funciona sin Tarjeta

Qapital usa **Plaid** — un API que se conecta al banco existente del usuario:

1. Usuario conecta su banco (Chase, BoA, etc.) via Plaid
2. Plaid lee saldo y transacciones en tiempo real
3. El usuario crea reglas de ahorro (round-ups, triggers)
4. Cuando se gatilla una regla, Qapital verifica saldo via Plaid e inicia transferencia ACH a la cuenta de ahorro en Lincoln Savings Bank

**El valor de Qapital nunca fue la tarjeta — fue la logica de ahorro basada en behavioral economics.**

### 8.3 Modelo de Revenue

| Fuente | % del Revenue |
|--------|--------------|
| **Suscripciones** ($3/$6/$12 USD/mes) | **~70-80%** |
| Interchange (tarjeta Visa) | ~15-20% |
| Depositos al banco partner | ~5% |

Con 2M usuarios y ~$6 USD promedio de suscripcion, Qapital tiene un run rate estimado de ~$100M+ USD anuales. **El interchange es secundario.**

### 8.4 Equivalente de Plaid en Chile

**Fintoc** es la opcion mas cercana a Plaid en Chile:

| Capacidad | Disponible |
|-----------|-----------|
| Leer transacciones | SI |
| Leer saldo | SI |
| Iniciar pagos | SI |
| Debito automatico (PAC) | SI |
| Bancos soportados | BancoEstado, BCI, Banco de Chile, Itau, BICE, Falabella, Santander, Scotiabank |
| Prepago/wallets | SI |

**Pricing Fintoc:**

| Concepto | Costo |
|----------|-------|
| Integracion | $0 |
| Comision por transaccion exitosa | 1.35% + IVA |
| Minimo mensual | 6.5 UF + IVA (~$250.000 CLP) |

---

## 9. Analisis de Modelos de Ingreso

### 9.1 Interchange: La Aritmetica

```
Tasa de intercambio prepago Chile:  0.80% (maximo regulado)
Split BaaS estandar:                70/30 (Tally 70%, BaaS 30%)
Interchange neto para Tally:        0.56% del monto transado
```

| Usuarios | Gasto Promedio/Mes | Interchange Neto/Mes | Interchange Neto/Ano |
|----------|-------------------|---------------------|---------------------|
| 100 | $150.000 CLP | $84.000 CLP (~USD 89) | ~USD 1.068 |
| 1.000 | $150.000 CLP | $840.000 CLP (~USD 894) | ~USD 10.680 |
| 5.000 | $150.000 CLP | $4.200.000 CLP (~USD 4.468) | ~USD 53.400 |

### 9.2 Cuatro Modelos de Negocio con 100 Usuarios

**Costos fijos mensuales con Pomelo:** ~$2.500 USD/mes ($30.000 USD/ano)

| Modelo | Revenue Anual (100 usuarios) | Costo Anual | Resultado |
|--------|----------------------------|-------------|-----------|
| **A: Interchange Puro** | $1.068 USD | $30.000 USD | **-$28.932 USD** |
| **B: Interchange + Suscripcion** (60% pagando ~$3.000 CLP) | $3.617 USD | $30.000 USD | **-$26.383 USD** |
| **C: Interchange + Suscripcion + SaaS B2B** (1 universidad) | $21.617 USD | $33.000 USD | **-$11.383 USD** |
| **D: C + Data Insights** (1 cliente) | $25.217 USD | $35.400 USD | **-$10.183 USD** |

**Conclusion: Con 100 usuarios, todos los modelos basados en tarjeta pierden dinero.** El modelo mas viable (C) aun requiere ~200 usuarios + 2 universidades pagando para alcanzar breakeven.

### 9.3 Breakeven por Modelo

| Modelo | Usuarios para Breakeven |
|--------|------------------------|
| Interchange puro | ~2.800 (imposible — nadie lo logra en Chile) |
| + Suscripcion | ~850 (dificil — mercado acostumbrado a gratis) |
| + SaaS B2B | ~200 + 2 universidades (mas realista) |
| + Data Insights | ~150 + 2 unis + 1 cliente data (requiere volumen minimo) |

---

## 10. Mercado de Venta de Datos

### 10.1 Mercado Global de Datos Alternativos

- Tamaño 2025: USD 18.740 millones (creciendo 21-33% anual)
- Datos transaccionales: 14% del gasto total del mercado
- Dataset promedio: USD 1.1M/ano (precio real promedio ~USD 63K/ano, 30% del rango publicado)
- 67% de los profesionales de inversion ya usan datos alternativos; 94% planea aumentar gasto

### 10.2 Realidad para Tally en Chile

| Comprador Potencial | Que Compraria | Precio Realista | Probabilidad |
|--------------------|--------------|----------------|-------------|
| Universidades | Patrones de gasto estudiantil | $500K - $2M CLP/ano | Media |
| Retail campus | Habitos de consumo | $200K - $500K CLP/ano | Baja |
| Consultoras | Data de Gen Z Chile | $1M - $5M CLP/ano | Baja-Media |
| Fondos de inversion | Consumer spending | No viable con <10K usuarios | Nula |

### 10.3 Restricciones

- Con 100-1.000 usuarios, **no hay volumen estadisticamente significativo** para generar insights vendibles
- **Datos de menores de 18: riesgo ROJO** (Ley 21.719 + riesgo reputacional destructivo)
- K-Anonymity sola no cumple con la definicion de anonimizacion "irreversible" de la ley chilena
- Se requiere differential privacy + documentacion exhaustiva + auditorias periodicas
- Los datos de menores, incluso anonimizados, enfrentarian escrutinio maximo por principio de interes superior del nino

**Conclusion:** La venta de datos es un revenue stream viable solo a partir de +5.000 usuarios mayores de 18, con compliance robusto. No es viable como fuente de ingreso temprana.

---

## 11. Opinion del CTO

### La evaluacion tecnica y financiera es inequivoca.

Toda la evidencia recopilada — regulatoria, financiera, de mercado, de competencia — apunta en la misma direccion:

**El negocio de tarjetas prepago en Chile no es rentable como producto standalone.** Esto no es una opinion; es un hecho demostrado por los resultados financieros de cada emisor no bancario en el pais:

- Tenpo (1.5M tarjetas): pierde $17M USD/ano
- Mercado Pago (4.1M tarjetas): pierde $1.3M USD/ano
- MACH (millones de usuarios): abandono el prepago, migro a cuenta corriente
- Fintual: obtuvo la licencia y decidio no usarla
- La propia industria califica el negocio como "maniatado" y pide cambios legales

Emitir una tarjeta con Pomelo para 1.000 usuarios universitarios generaria ~$894 USD/mes de interchange y costaria ~$2.500 USD/mes de operacion. Es una operacion estructuralmente deficitaria.

### Lo que SI tiene valor diferencial

El problema que Tally resuelve es real: la salud financiera de la Gen Z en Chile esta en minimos historicos. La solucion — un asistente de IA personalizado (Gus) + gamificacion + behavioral economics + dashboards con datos reales — es genuinamente diferenciada. Nadie en Chile ofrece educacion financiera aplicada con datos reales del usuario.

Pero ese valor no requiere emitir una tarjeta. Requiere:

1. **Leer los datos financieros del estudiante** (su CuentaRUT, MACH o Tenpo) — posible hoy con Fintoc
2. **Aplicar inteligencia sobre esos datos** — Gus, categorizacion, reglas de ahorro, gamificacion
3. **Monetizar via la institucion educativa** (SaaS B2B) y via el estudiante (suscripcion premium)

Qapital — la referencia directa del libro blanco — lo confirma: operaron 4 anos sin tarjeta, consiguieron 400.000 usuarios, levantaron $12M, y recien ahi lanzaron tarjeta. El modelo de suscripcion representa el 70-80% de su revenue, no el interchange.

### Los riesgos del enfoque actual

| Riesgo | Probabilidad | Impacto |
|--------|-------------|---------|
| Gastar $50K+ en tarjeta antes de validar demanda | Alta | Burn de runway sin product-market fit |
| No alcanzar volumen suficiente para breakeven con interchange | Muy Alta | Operacion permanentemente deficitaria |
| Competir contra MACH/Tenpo/Mercado Pago en un mercado comoditizado | Alta | Diferenciacion nula como "otra tarjeta mas" |
| Complejidad regulatoria con menores (colegios) | Alta | Demoras, costos legales, riesgo reputacional |
| Dependencia de Pomelo sin negociar terminos favorables | Media | Costos fijos que no escalan |

### El camino que recomiendo

Lanzar como **plataforma de educacion financiera con datos reales** (sin tarjeta), conectada via Fintoc a las cuentas que los estudiantes ya tienen. Monetizar via SaaS B2B a universidades + suscripciones premium. Costo del primer año: ~$4.400 USD (vs $47.400 USD con tarjeta). Potencialmente rentable desde el mes 1 si una universidad paga.

La tarjeta puede venir despues — como expansion natural cuando haya traccion real, revenue estable, y capital de un levantamiento. Desde una posicion de fuerza, no de necesidad.

---

## 12. Fuentes

### Regulatorias
- [CMF — Emisores de Tarjetas de Pago con Provision de Fondos no Bancarias](https://www.cmfchile.cl/portal/principal/613/w3-propertyvalue-47742.html)
- [CMF — Solicitud de Inscripcion como Emisor](https://www.cmfchile.cl/portal/principal/613/w3-article-69081.html)
- [Ley 21.521 (Ley Fintec) — Biblioteca del Congreso](https://www.bcn.cl/leychile/navegar?idNorma=1187323)
- [Ley 21.719 (Proteccion de Datos) — Biblioteca del Congreso](https://www.bcn.cl/leychile/navegar?idNorma=1209272)
- [CMF — SFA consulta publica noviembre 2025](https://www.cmfchile.cl/portal/prensa/615/w3-article-100482.html)
- [SFA aplazado a 2027 — LatAm Fintech](https://www.latamfintech.co/articles/la-comision-para-el-mercado-financiero-en-chile-aplaza-la-entrada-en-vigencia-del-sistema-de-finanzas-abiertas-en-y-pone-en-consulta-nueva-norma)

### Tasas de Intercambio
- [Comite Tecnico define tasas — Diario Financiero](https://www.df.cl/mercados/banca-fintech/comite-tecnico-define-tasas-de-intercambio-y-baja-los-cobros-en-tarjetas)
- [Tasas de intercambio Chile — Chocale](https://chocale.cl/2023/02/comite-fijacion-tasas-de-intercambio-pagos-tarjetas-chile/)
- [Visa Chile — Tasas de intercambio](https://www.visa.cl/acerca-de-visa/tasas-de-intercambio.html)
- [Mastercard Chile — Tasas de intercambio](https://www.mastercard.cl/es-cl/empresas/empresas-pequenas-medianas/soporte/intercambio.html)
- [Banco Central — Fijacion limites (PDF)](https://www.bcentral.cl/documents/33528/4387486/RIII.1.pdf)

### Industria Prepago Chile
- [Emisores prepago cerraron 2023 en numeros rojos — Diario Financiero](https://www.df.cl/mercados/banca-fintech/emisores-de-tarjetas-de-prepago-no-bancario-cerraron-2023-con-numeros-rojos)
- [Emisores prepago numeros rojos — CIEDESS](https://www.ciedess.cl/601/w3-article-14125.html)
- [Tarjetas prepago: negocio maniatado — IUPANA](https://iupana.com/2025/04/09/tarjetas-prepago-en-chile-un-negocio-maniatado/)
- [Tarjetas prepago crecieron 103% — FintechChile](https://www.fintechile.org/noticias/tarjetas-prepago-crecieron-103-en-2025-y-alcanzan-montos-por-us-2-536-millones)
- [MACH se transforma en MachBank](https://pnwyacht.com/2026/03/10/mach-se-transforma-en-machbank-de-bci-tras-sumar/)
- [Tenpo cierra Tenpo Business — Chocale](https://chocale.cl/2024/03/tenpo-business-cierre-tarjeta-de-prepago-empresas-emprendedores/)

### Caso Fintual
- [CMF autoriza a Fintual, descarta tarjeta — Diario Financiero](https://www.df.cl/mercados/banca-fintech/cmf-autoriza-a-fintual-como-emisor-de-tarjetas-de-prepago-pero-fintech)
- [Fintual obtiene licencia, no habra tarjeta — Chocale](https://chocale.cl/2024/11/fintual-obtiene-licencia-para-operar-cuentas-prepago-pero-descarta-lanzar-una-tarjeta-en-el-corto-plazo/)
- [Pedro Pineda sobre captacion — Chocale](https://chocale.cl/2024/11/pedro-pineda-ceo-fintual-captacion-bancos-inversiones-futuro-fintech/)
- [Fintual avanza en plan AFP — El Dinamo](https://www.eldinamo.cl/economia/negocios-economia/2026/03/30/fintual-avanza-en-plan-de-formar-afp-realiza-estudios-y-espera-definicion-de-reglamentos-sobre-flexibilidad-de-las-inversiones/)

### Modelo Qapital
- [Qapital — Wikipedia](https://en.wikipedia.org/wiki/Qapital)
- [Qapital checking + debit card — TechCrunch (2017)](https://techcrunch.com/2017/08/03/qapital-checking-debit-card/)
- [Qapital + Plaid case study](https://plaid.com/customer-stories/qapital/)
- [Qapital Business Model — BreakEven Calculator](https://breakevenpointcalculator.com/how-does-qapital-make-money-business-model-explained/)
- [LSBX — Community Banking as a Service](https://www.lsbx.com/)
- [How Qapital uses IFTTT — Tearsheet](https://tearsheet.co/uncategorized/how-qapital-uses-ifttt-to-create-endless-savings-triggers/)

### Proveedores BaaS
- [Pomelo — sitio oficial](https://pomelo.la/en)
- [Pomelo BIN Sponsorship](https://pomelo.la/en/bin-sponsorship/)
- [Dock — BaaS](https://dock.tech/en/solution/banking/)
- [Galileo — Pricing](https://www.galileo-ft.com/pricing/)
- [Galileo — About Fees (docs)](https://docs.galileo-ft.com/pro/docs/about-fees)

### Conectividad Bancaria (Equivalente a Plaid)
- [Fintoc — Sistema Operativo de Pagos](https://fintoc.com/)
- [Fintoc Pricing Chile](https://fintoc.com/cl/pricing-chile)
- [Fintoc raises $7M — TechCrunch](https://techcrunch.com/2024/04/25/fintoc-a2a-payments-chile-mexico/)
- [Belvo — Open finance LatAm](https://belvo.com/)

### Proteccion de Datos
- [Guia Ley 21.719 — Prey Project](https://preyproject.com/es/blog/ley-de-proteccion-de-datos-en-chile)
- [Autonomia progresiva y datos de menores](https://actualidadjuridica.doe.cl/autonomia-progresiva-y-tratamiento-de-datos-personales-de-ninos-ninas-y-adolescentes/)

### Mercado de Datos Alternativos
- [Alternative Data Market — Grand View Research](https://www.grandviewresearch.com/industry-analysis/alternative-data-market)
- [Alternative data spending $15.4B — Yahoo Finance / Neudata](https://finance.yahoo.com/news/alternative-data-spending-investment-management-110000300.html)
- [Consumer Spending Data Providers — Datarade](https://datarade.ai/data-categories/consumer-spending-data/providers)

### Menores de Edad y Productos Financieros
- [MACH BCI cuenta para menores](https://www.bci.cl/saladeprensa/noticias-sostenibilidad/posts/mach-bci-lanza-la-primera-cuenta-digital-para-menores-de-edad)
- [Teenpo cuenta para adolescentes — Chocale](https://chocale.cl/2023/06/teenpo-cuenta-digital-tenpo-adolescentes-14-17-anos/)
- [CuentaRUT menores — BancoEstado](https://www.bancoestado.cl/content/bancoestado-public/cl/es/home/home/centro-de-ayuda/productos/cuentas/cuentarut/-puede-un-menor-de-edad-abrir-una-cuentarut-.html)

---

*Documento preparado con investigacion primaria de fuentes regulatorias (CMF, BCCh, Biblioteca del Congreso), prensa especializada (Diario Financiero, Chocale, IUPANA, TechCrunch), documentacion tecnica de proveedores (Pomelo, Fintoc, Galileo), y datos de mercado verificados.*
