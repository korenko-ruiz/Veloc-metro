# VelociGPS — cómo compilar el APK

App de velocímetro GPS: mapa en vivo, velocímetro analógico/digital, odómetro,
historial de viajes, alerta de velocidad, Waze, reproductor de música y tema
día/noche automático. Es HTML/CSS/JS puro (sin frameworks ni build tools), así
que no necesitas compilar nada para probarla — solo empaquetarla con Capacitor.

## 0. Requisitos (una sola vez)

- **Node.js** (LTS) → https://nodejs.org
- **Android Studio** (incluye el Android SDK) → https://developer.android.com/studio

## 1. Probar la app en tu navegador (opcional, recomendado primero)

Antes de compilar nada, puedes abrir `www/index.html` con un servidor local y
probarla en Chrome de tu teléfono (conectado a la misma red que tu compu) para
ver el velocímetro, el mapa y el resto de funciones. La forma más simple:

```bash
cd veloci-gps/www
npx serve .
```

Te dará una URL tipo `http://192.168.x.x:3000` — ábrela en el navegador del
teléfono. El GPS y el mapa deben funcionar ahí mismo (el wake lock y el
reproductor de música local también).

## 2. Instalar dependencias

```bash
cd veloci-gps
npm install
```

## 3. Agregar la plataforma Android

```bash
npx cap add android
npx cap sync android
```

Esto crea la carpeta `android/` con el proyecto nativo, y copia el permiso de
ubicación automáticamente (lo trae el plugin `@capacitor/geolocation`).

## 4. Compilar el APK

**Opción A — con Android Studio (más simple):**

```bash
npx cap open android
```

Se abre Android Studio. Ve a **Build → Build Bundle(s) / APK(s) → Build
APK(s)**. Cuando termine, aparece un enlace "locate" — ahí está tu
`app-debug.apk`.

**Opción B — por terminal, sin abrir Android Studio:**

```bash
cd android
./gradlew assembleDebug        # en Windows: gradlew.bat assembleDebug
```

El APK queda en:
`android/app/build/outputs/apk/debug/app-debug.apk`

## 5. Instalar el APK en tu teléfono

Copia ese archivo `.apk` a tu teléfono (por USB, Drive, WhatsApp, etc.) y
ábrelo para instalarlo. Puede que Android pida activar "Instalar apps de
orígenes desconocidos" la primera vez — es normal, es tu propio APK, no algo
de la Play Store.

## Cada vez que cambies el código (`www/`)

Solo necesitas repetir la sincronización y recompilar, no todo desde cero:

```bash
npx cap sync android
cd android && ./gradlew assembleDebug
```

## Notas

- **Sin API keys**: el mapa usa tiles gratuitos de CARTO (sin registro), y el
  clima usa Open-Meteo (gratis, sin key).
- **GPS**: dentro del APK usa el plugin `@capacitor/geolocation`, que pide el
  permiso de ubicación de Android automáticamente. En el navegador normal cae
  de vuelta a la API web estándar, para que puedas probarla sin compilar.
- **APK de debug vs. firmado**: `assembleDebug` genera un APK que puedes
  instalar y usar tú mismo sin problema. Si más adelante quieres publicarla en
  Play Store, se necesita firmarla (`assembleRelease` + una keystore) — eso ya
  es un paso aparte, avísame cuando llegues ahí y te guío.
