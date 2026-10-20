import groovy.json.JsonSlurper
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val appVersion = (JsonSlurper().parse(file("../../../tauri.conf.json")) as Map<*, *>)["version"] as String
val appBuild = Regex("""CURRENT_VERSION_HASH\s*=\s*['"](\d+)['"]""")
    .find(file("../../../../src/utils/updater.ts").readText())
    ?.groupValues?.get(1)?.toInt()
    ?: error("Missing numeric CURRENT_VERSION_HASH")

android {
    compileSdk = 36
    namespace = "com.exam.test_system"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.exam.test_system"
        minSdk = 24
        targetSdk = 36
        versionCode = appBuild
        versionName = appVersion
        
        // 只构建 arm64-v8a 架构
        ndk {
            abiFilters.add("arm64-v8a")
        }
    }


    
    val signingProperties = Properties().apply {
        val propertiesFile = file("keystore.properties")
        if (propertiesFile.exists()) propertiesFile.inputStream().use { load(it) }
    }
    signingConfigs {
        create("release") {
            storeFile = file(signingProperties.getProperty("storeFile") ?: System.getenv("ANDROID_KEYSTORE_PATH") ?: "release-key.jks")
            storePassword = signingProperties.getProperty("storePassword") ?: System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias = signingProperties.getProperty("keyAlias") ?: System.getenv("ANDROID_KEY_ALIAS") ?: "release"
            keyPassword = signingProperties.getProperty("keyPassword") ?: System.getenv("ANDROID_KEY_PASSWORD")
        }
    }
    
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = false
            isMinifyEnabled = false
        }
        getByName("release") {
            isMinifyEnabled = true
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }

    // 配置APK输出文件名
    applicationVariants.all {
        val variant = this
        variant.outputs
            .map { it as com.android.build.gradle.internal.api.ApkVariantOutputImpl }
            .forEach { output ->
                val flavorName = variant.flavorName ?: "universal"
                val abiName = when (flavorName.lowercase()) {
                    "arm64" -> "arm64"
                    "arm" -> "arm"
                    "x86" -> "x86"
                    "x86_64" -> "x86_64"
                    else -> flavorName
                }
                val version = variant.versionName
                output.outputFileName = "Answer_Test_v${version}-${abiName}-${variant.buildType.name}.apk"
            }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
    packaging {
        jniLibs.keepDebugSymbols.add("**/libanswer_test_lib.so")
    }
}

rust {
    rootDirRel = "../../../"
}

// rustBuild runs before JNI merging; failures must prevent packaging an old library.

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")
