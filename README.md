# HaxRef Pro

Haxref es un proyecto en desarrollo en el lenguaje HTML, CSS y JS. 

## Funciones:

### Webhooks de Discord:
La nueva función insignia de la 2.0!. Ahora puedes enviar en tiempo real el marcador, las faltas/tarjetas y el inicio, medio tiempo y final del partido a un canal en Discord, todo sin entrar una vez lo configures.

### Contador de goles:
La app cuenta con un contador de goles sencillo pero estilizado, click izquierdo suma, click derecho resta.

### Tarjetas / amonestaciones:
Este sector cuenta con botones de TA (tarjeta amarilla) y TR (tarjeta roja), presiona el botón e ingresa el nombre del jugador, automáticamente se agrega a la lista de tarjetas de ese equipo.
Posteriormente a agregar a un jugador, aparecerá su nombre cuando presiones el botón de tarjetas, si detecta que fueron dos tarjetas amarillas, cambia a roja.

### Reporte / Informe:
La app puede generar un informe de los contadores y tarjetas que se hayan añadido durante el partido. Para guardar el informe solo da click en "copiar informe".

### Inicio / Final del partido:
El botón inicio del partido agrega la hora en la que lo presiones al informe. El botón finalizar agrega la hora en la que lo presiones al informe. Si presionas estos dos botones a tiempo, tendrás en el informe la hora exacta en la que inició y terminó.

### Swap / Rotación:
Puedes presionar el botón de swap y/o el botón (click) de middle mouse (ruedita del mouse). Todos los contadores, tarjetas y amonestaciones cambian de lugar al hacer esto, no afecta al informe generado.

### Autoguardado:
HaxRef utiliza el caché de el navegador para guardar las partidas, su nombre técnico es LocalStorage. Una vez termine un partido o salgas de él puedes continuar agregando goles, tarjetas y seguir copiando los reportes.

### Funciones adicionales:
HaxRef puede corregir la hora de inicio, para hacerlo simplemente dá doble click en el botón iniciar, ahora el tiempo empezará a correr desde ese doble click, el informe se actualizará automáticamente.
