package com.thanglv.robolangchain;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;

@SpringBootApplication
@EnableAsync
public class RoboLangChainApplication {

	public static void main(String[] args) {
		SpringApplication.run(RoboLangChainApplication.class, args);
	}

}
