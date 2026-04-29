# HaxRef Pro

Haxref es un proyecto HTML. 
Hay cambios en la licencia a partir de la versión 2.4, por favor, léala.

## Funciones:

### Dynamic-Mark:
Ha llegado el Dynamic-Mark, un marcador **visual** de el estado del partido directo a el canal de discord de tu elecicón, un marcador profesional sin complicarte. Además, esto permite incluir los logos de los equipos en este mismo marcador (PNG, soporta transparencias).

### Contador de goles:
La app cuenta con un contador de goles sencillo pero estilizado, click izquierdo suma, click derecho resta, hay shortcuts de teclado que permiten agilizar esto: ctrl + "." para gol de Red y ctrl + "-" para gol de Blue.

### Tarjetas / amonestaciones:
Este sector cuenta con botones de TA (tarjeta amarilla) y TR (tarjeta roja), presiona el botón e ingresa el nombre del jugador y su motivo (opcional), automáticamente se agrega a la lista de tarjetas de ese equipo en el Dynamic-Mark.
Posteriormente a agregar a un jugador, aparecerá su nombre cuando presiones el botón de tarjetas, si detecta que fueron dos tarjetas amarillas, cambia a roja. Esta función edita el dynamic-Mark con el nombre del jugador y su equipo.

### Inicio / Final del partido:
Estos botones controlan el Dynamic-Mark para controlar el partido, el de inicio lo envía por primera vez, el del final dá por terminado el partido, con un claro "finalizado" en el mrcador.

### Swap / Rotación:
Al presionar el botón "inicio de medio tiempo" los equipos, sus tarjetas y sus goles rotan, incluso en el Dynamic-Mark. 

### Autoguardado:
HaxRef Online utiliza el caché de el navegador para guardar las partidas, su nombre técnico es LocalStorage. Una vez termine un partido o salgas de él puedes continuar viendo el resultado y corrigiendo el resultado si estuvo mal.

### Configuración:
se han añadido ciertos parámetros de configuración para que puedas personalizar tu experiencia usando HaxRef, puedes verlos todos en la sección "config" en la app (el botón de engranaje).

### Funciones adicionales:
Dynamic-Bar: esta función permite ver de manera visual el tiempo transcurrido en el partido, editable desde la sección "marcador" en la NavBar.
