import java.io.File
import java.security.MessageDigest
import org.apache.tools.ant.taskdefs.condition.Os
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.logging.LogLevel
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.TaskAction

open class BuildTask : DefaultTask() {
    @Input
    var rootDirRel: String? = null
    @Input
    var target: String? = null
    @Input
    var release: Boolean? = null

    @TaskAction
    fun assemble() {
        val rustRoot = File(project.projectDir, rootDirRel ?: error("rootDirRel cannot be null")).canonicalFile
        val expected = project.findProperty("verifiedNativeSha256") as? String
        if (expected != null) {
            if (target != "aarch64") throw GradleException("Verified prebuild supports arm64 only")
            val profile = if (release == true) "release" else "debug"
            val built = File(rustRoot, "target/aarch64-linux-android/$profile/libanswer_test_lib.so")
            val copied = File(project.projectDir, "src/main/jniLibs/arm64-v8a/libanswer_test_lib.so")
            for (library in listOf(built, copied)) {
                if (!library.isFile) throw GradleException("Missing freshly compiled library: $library")
                val sha = MessageDigest.getInstance("SHA-256")
                library.inputStream().use { stream ->
                    val buffer = ByteArray(65536)
                    while (true) {
                        val size = stream.read(buffer)
                        if (size < 0) break
                        sha.update(buffer, 0, size)
                    }
                }
                val actual = sha.digest().joinToString("") { "%02x".format(it) }
                if (!actual.equals(expected, ignoreCase = true)) throw GradleException("Native library changed after compilation: $library")
            }
            logger.lifecycle("Verified freshly compiled arm64 native library SHA256: $expected")
            return
        }
        if (!Os.isFamily(Os.FAMILY_WINDOWS)) {
            runTauriCli("npm")
            return
        }
        val repo = rustRoot.parentFile
        project.exec {
            workingDir(repo)
            executable(File(System.getenv("SystemRoot"), "System32/WindowsPowerShell/v1.0/powershell.exe").absolutePath)
            args("-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                File(repo, "scripts/build-android.ps1").absolutePath, "-NativeOnly",
                "-Target", target ?: error("target cannot be null"),
                "-Profile", if (release == true) "release" else "debug")
        }.assertNormalExitValue()
    }

    fun runTauriCli(executable: String) {
        val rootDirRel = rootDirRel ?: throw GradleException("rootDirRel cannot be null")
        val target = target ?: throw GradleException("target cannot be null")
        val release = release ?: throw GradleException("release cannot be null")
        val args = listOf("run", "--", "tauri", "android", "android-studio-script");

        project.exec {
            workingDir(File(project.projectDir, rootDirRel))
            executable(executable)
            args(args)
            if (project.logger.isEnabled(LogLevel.DEBUG)) {
                args("-vv")
            } else if (project.logger.isEnabled(LogLevel.INFO)) {
                args("-v")
            }
            if (release) {
                args("--release")
            }
            args(listOf("--target", target))
        }.assertNormalExitValue()
    }
}
