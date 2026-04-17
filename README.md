# HaxRef Pro

Haxref es un proyecto en HTML. 
Para ver los cambios y versiones más recientes checa este github, la página oficial puede estar desactualizada.

## Funciones:

### Webhooks de Discord:
La función insignia de la 2.0!. Ahora puedes enviar en tiempo real el marcador, las faltas/tarjetas y el inicio, medio tiempo y final del partido a un canal en Discord, todo a un click una vez lo configures.

### Contador de goles:
La app cuenta con un contador de goles sencillo pero estilizado, click izquierdo suma, click derecho resta, nada complejo, nada más.

### Tarjetas / amonestaciones:
Este sector cuenta con botones de TA (tarjeta amarilla) y TR (tarjeta roja), presiona el botón e ingresa el nombre del jugador, automáticamente se agrega a la lista de tarjetas de ese equipo.
Posteriormente a agregar a un jugador, aparecerá su nombre cuando presiones el botón de tarjetas, si detecta que fueron dos tarjetas amarillas, cambia a roja. Esto envía un webhook con la sanción, el nombre del jugador y su equipo.

### Mensajes editables
Sustituyendo a la sección reporte se agregó la sección "mensajes", puedes personalizar cómo se ven los mensajes que se envían al canal mediante el webhook, personaliza cada encuentro sin complicarte en HaxRef Pro.

### Inicio / Final del partido:
El botón inicio del partido dispara el webhook, mientras no inicies el partido no puedes agregar goles como medida de seguridad. El botón finalizar dispara el webhook de final de partido con el resultado y las tajetas que se hayan dado en el partido.

### Swap / Rotación:
Al presionar el botón de medio tiempo se rota el marcador junto con las tarjetas y goles y se envía el webhook, el botón de final de medio tiempo no hace nada, solo dispara el webhook. 

### ID Mensajes / Mensajes editables o eliminables
Se ha añadido una función para eliminar goles automáticamente si se eliminan del marcador, siempre pedirá confirmación. TODOS los mensajes son editables como texto plano desde la sección mensajes si así lo deseas.

### Autoguardado:
HaxRef Online y HaxRef Pro utilizan el caché de el navegador para guardar las partidas, su nombre técnico es LocalStorage. Una vez termine un partido o salgas de él puedes continuar viendo el resultado y corrigiendo el resultado si estuvo mal.

### Configuración:
se han añadido ciertos parámetros de configuración para que puedas personalizar tu experiencia usando HaxRef, puedes verlos todos en la sección "config" en la app o el botón de engranaje.

### Funciones adicionales:
HaxRef puede corregir la hora de inicio, para hacerlo simplemente dá doble click en el botón iniciar, ahora el tiempo empezará a correr desde ese doble click, el webhook se actualizará automáticamente.
