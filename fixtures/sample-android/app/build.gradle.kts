// Fixture: exercises resValue resolution, including a properties lookup and a
// name that differs per flavor (both values must be checked).
android {
    defaultConfig {
        applicationId = "com.example.sample"
    }

    productFlavors {
        create("prod") {
            resValue(
                type = "string",
                name = "attribution_host",
                value = deployProperties["ATTRIBUTION_HOST_PROD"] as String
            )
        }
        create("dev") {
            resValue(
                type = "string",
                name = "attribution_host",
                value = deployProperties["ATTRIBUTION_HOST_DEV"] as String
            )
        }
    }
}
