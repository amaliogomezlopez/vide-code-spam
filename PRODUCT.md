# Product

## Register

product

## Users

Desarrolladores que coordinan varios agentes de programación por CLI desde una
misma aplicación de escritorio. Trabajan durante sesiones largas con varias
terminales, repositorios y Git worktrees abiertos a la vez, principalmente en
Windows, y necesitan reconocer de inmediato qué agente, carpeta, checkout y
rama están utilizando antes de enviar una instrucción.

## Product Purpose

Vibe Spam reúne terminales interactivas y dictado en una sola superficie para
reducir el coste de coordinar varios CLIs de programación. La aplicación debe
permitir abrir, observar y dirigir agentes sin perder el contexto del proyecto.
El éxito significa que el usuario entiende de un vistazo qué está ejecutándose,
dónde trabaja cada terminal y cuál recibirá la siguiente entrada, incluso cuando
conviven varios repositorios y worktrees.

## Brand Personality

Técnica, compacta y fiable. La interfaz debe sentirse como una herramienta de
trabajo precisa y tranquila: densa cuando aporta información, directa en sus
acciones y predecible durante sesiones prolongadas.

## Anti-references

- No convertir Vibe Spam en un clon de un IDE completo.
- No reproducir la densidad visual de un panel Git que expone todas las
  operaciones y estados al mismo nivel.
- No usar decoración de producto SaaS, animaciones ornamentales ni paneles que
  resten espacio a las terminales.
- No ocultar cambios de contexto importantes ni vincular implícitamente la
  selección Git con el destino de voz.

## Design Principles

1. **Contexto antes que acción.** Mostrar el destino activo y su relación con
   repositorio, worktree y rama antes de permitir una acción contextual.
2. **Una sola representación de cada realidad.** Agrupar terminales que
   comparten checkout en lugar de repetir el mismo estado Git en cada una.
3. **Progresión segura.** Empezar por observación y navegación; incorporar las
   operaciones Git de escritura únicamente con estados, bloqueos y
   confirmaciones inequívocos.
4. **Densidad que se pueda recorrer.** Priorizar jerarquía, etiquetas breves y
   revelado progresivo para conservar el espacio de trabajo principal.
5. **Fiabilidad local.** Mantener el comportamiento útil, rápido y comprensible
   sin depender de servicios remotos.

## Accessibility & Inclusion

Objetivo WCAG 2.2 AA para la interfaz aplicable de escritorio: navegación
completa por teclado, foco visible, nombres accesibles, contraste suficiente y
estados que no dependan únicamente del color. Respetar
`prefers-reduced-motion`, mantener zonas de interacción cómodas aun con una
densidad compacta y evitar que el filtrado o la actualización automática
desplacen el foco del usuario.
