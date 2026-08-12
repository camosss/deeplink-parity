android {
    defaultConfig {
        applicationId = "com.example.sample"
    }

    buildTypes {
        // a suffixed variant is still our app; assetlinks on a dev domain names it
        getByName("debug") {
            applicationIdSuffix = ".dev"
        }
    }
}
