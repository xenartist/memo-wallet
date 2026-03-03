# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# ===== React Native =====
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }

# Keep JS bridge interface methods
-keepclassmembers class * {
    @com.facebook.react.bridge.ReactMethod *;
}

# ===== Hermes =====
-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.hermes.intl.** { *; }

# ===== Solana Mobile / Seed Vault =====
-keep class com.solanamobile.** { *; }
-keep interface com.solanamobile.** { *; }

# ===== BouncyCastle (crypto) =====
-keep class org.bouncycastle.** { *; }
-dontwarn org.bouncycastle.**

# ===== OkHttp / Okio (network) =====
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }

# ===== React Native Camera Kit =====
-keep class com.wix.reactnativecamerakit.** { *; }

# ===== React Native Vector Icons =====
-keep class com.oblador.vectoricons.** { *; }

# ===== React Native WebView =====
-keep class com.reactnativecommunity.webview.** { *; }

# ===== Google ML Kit (via camera-kit dependency) =====
-keep class com.google.mlkit.** { *; }
-dontwarn com.google.mlkit.**

# ===== General Android =====
-keepattributes *Annotation*
-keepattributes SourceFile,LineNumberTable
-keep public class * extends java.lang.Exception
