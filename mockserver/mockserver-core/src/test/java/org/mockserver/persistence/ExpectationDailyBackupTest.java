package org.mockserver.persistence;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.mockserver.closurecallback.websocketregistry.WebSocketClientRegistry;
import org.mockserver.configuration.Configuration;
import org.mockserver.logging.MockServerLogger;
import org.mockserver.mock.Expectation;
import org.mockserver.mock.RequestMatchers;
import org.mockserver.scheduler.Scheduler;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;

import static org.hamcrest.CoreMatchers.containsString;
import static org.hamcrest.CoreMatchers.is;
import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.empty;
import static org.mockserver.configuration.Configuration.configuration;
import static org.mockserver.mock.listeners.MockServerMatcherNotifier.Cause.API;
import static org.mockserver.model.HttpRequest.request;
import static org.mockserver.model.HttpResponse.response;

public class ExpectationDailyBackupTest {

    private static final Clock FIXED_CLOCK = Clock.fixed(Instant.parse("2026-03-15T15:00:00Z"), ZoneOffset.UTC);

    private MockServerLogger mockServerLogger;
    private RequestMatchers requestMatchers;
    private Scheduler scheduler;

    @Before
    public void createRequestMatchers() {
        Configuration matcherConfiguration = configuration();
        mockServerLogger = new MockServerLogger(matcherConfiguration, ExpectationDailyBackupTest.class);
        scheduler = new Scheduler(matcherConfiguration, mockServerLogger);
        requestMatchers = new RequestMatchers(matcherConfiguration, mockServerLogger, scheduler, new WebSocketClientRegistry(matcherConfiguration, mockServerLogger));
    }

    @After
    public void stopScheduler() {
        if (scheduler != null) {
            scheduler.shutdown();
        }
    }

    @Test
    public void shouldDoNothingWhenDirectoryIsBlank() throws Exception {
        Path unused = Files.createTempDirectory("expectation-backup-off");
        ExpectationDailyBackup backup = new ExpectationDailyBackup(
            configuration().expectationBackupDirectory(""),
            mockServerLogger,
            requestMatchers,
            FIXED_CLOCK,
            true
        );
        try {
            backup.writeBackup();
            try (Stream<Path> children = Files.list(unused)) {
                assertThat(children.toList(), empty());
            }
        } finally {
            backup.stop();
        }
    }

    @Test
    public void shouldWriteDatedExpectationFile() throws Exception {
        Path directory = Files.createTempDirectory("expectation-backup");
        ExpectationDailyBackup backup = new ExpectationDailyBackup(
            configuration().expectationBackupDirectory(directory.toString()),
            mockServerLogger,
            requestMatchers,
            FIXED_CLOCK,
            false
        );
        try {
            requestMatchers.add(new Expectation(request().withPath("/backup"))
                .withId("backup-one")
                .thenRespond(response().withBody("ok")), API);

            backup.writeBackup();

            Path file = directory.resolve("expectation-2026-03-15.json");
            assertThat(Files.exists(file), is(true));
            String json = Files.readString(file, StandardCharsets.UTF_8);
            assertThat(json, containsString("\"path\" : \"/backup\""));
            assertThat(json, containsString("\"id\" : \"backup-one\""));
        } finally {
            backup.stop();
        }
    }

    @Test
    public void shouldOverwriteSameDayBackup() throws Exception {
        Path directory = Files.createTempDirectory("expectation-backup-overwrite");
        ExpectationDailyBackup backup = new ExpectationDailyBackup(
            configuration().expectationBackupDirectory(directory.toString()),
            mockServerLogger,
            requestMatchers,
            FIXED_CLOCK,
            false
        );
        try {
            requestMatchers.add(new Expectation(request().withPath("/first"))
                .withId("one")
                .thenRespond(response().withBody("first")), API);
            backup.writeBackup();

            requestMatchers.add(new Expectation(request().withPath("/second"))
                .withId("two")
                .thenRespond(response().withBody("second")), API);
            backup.writeBackup();

            Path file = directory.resolve("expectation-2026-03-15.json");
            String json = Files.readString(file, StandardCharsets.UTF_8);
            assertThat(json, containsString("\"path\" : \"/second\""));
            try (Stream<Path> children = Files.list(directory)) {
                assertThat(children.filter(path -> path.getFileName().toString().startsWith("expectation-")).count(), is(1L));
            }
        } finally {
            backup.stop();
        }
    }

    @Test
    public void shouldWriteEmptyArrayWhenThereAreNoExpectations() throws Exception {
        Path directory = Files.createTempDirectory("expectation-backup-empty");
        ExpectationDailyBackup backup = new ExpectationDailyBackup(
            configuration().expectationBackupDirectory(directory.toString()),
            mockServerLogger,
            requestMatchers,
            FIXED_CLOCK,
            false
        );
        try {
            backup.writeBackup();
            assertThat(Files.readString(directory.resolve("expectation-2026-03-15.json"), StandardCharsets.UTF_8), is("[]"));
        } finally {
            backup.stop();
        }
    }

    @Test
    public void shouldDelayUntilNextUtcMidnight() {
        assertThat(ExpectationDailyBackup.millisUntilNextUtcMidnight(FIXED_CLOCK), is(TimeUnit.HOURS.toMillis(9)));
        Clock midnight = Clock.fixed(Instant.parse("2026-03-15T00:00:00Z"), ZoneOffset.UTC);
        assertThat(ExpectationDailyBackup.millisUntilNextUtcMidnight(midnight), is(TimeUnit.DAYS.toMillis(1)));
        assertThat(LocalDate.now(FIXED_CLOCK).format(ExpectationDailyBackup.FILE_DATE), is("2026-03-15"));
    }
}
