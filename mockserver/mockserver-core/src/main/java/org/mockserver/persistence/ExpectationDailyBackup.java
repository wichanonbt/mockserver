package org.mockserver.persistence;

import com.fasterxml.jackson.databind.ObjectWriter;
import org.mockserver.configuration.Configuration;
import org.mockserver.file.FileCreator;
import org.mockserver.log.model.LogEntry;
import org.mockserver.logging.MockServerLogger;
import org.mockserver.mock.Expectation;
import org.mockserver.mock.RequestMatchers;
import org.mockserver.serialization.SerializationFailure;
import org.mockserver.serialization.model.ExpectationDTO;
import org.mockserver.serialization.serializers.response.TimeToLiveDTOPersistenceSerializer;

import java.io.IOException;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.apache.commons.lang3.StringUtils.isBlank;
import static org.mockserver.serialization.ObjectMapperFactory.createObjectMapper;
import static org.slf4j.event.Level.ERROR;
import static org.slf4j.event.Level.INFO;

/**
 * Dated daily snapshots of active expectations as JSON, distinct from the live
 * {@link ExpectationFileSystemPersistence} file that is overwritten on every change.
 * Each UTC day writes {@code expectation-yyyy-MM-dd.json} into {@code expectationBackupDirectory};
 * an empty directory turns this off. Kubernetes should point the directory at a PVC mount.
 */
public class ExpectationDailyBackup {

    static final DateTimeFormatter FILE_DATE = DateTimeFormatter.ofPattern("yyyy-MM-dd");
    private static final AtomicInteger THREAD_INDEX = new AtomicInteger();

    private final MockServerLogger mockServerLogger;
    private final RequestMatchers requestMatchers;
    private final ObjectWriter objectWriter;
    private final Clock clock;
    private final Path directory;
    private final ScheduledExecutorService scheduler;

    public ExpectationDailyBackup(Configuration configuration, MockServerLogger mockServerLogger, RequestMatchers requestMatchers) {
        this(configuration, mockServerLogger, requestMatchers, Clock.systemUTC(), true);
    }

    ExpectationDailyBackup(Configuration configuration, MockServerLogger mockServerLogger, RequestMatchers requestMatchers, Clock clock, boolean startScheduler) {
        this.mockServerLogger = mockServerLogger;
        this.requestMatchers = requestMatchers;
        this.clock = clock;
        String configured = configuration != null ? configuration.expectationBackupDirectory() : "";
        if (isBlank(configured)) {
            this.directory = null;
            this.objectWriter = null;
            this.scheduler = null;
            return;
        }
        this.directory = Paths.get(configured);
        this.objectWriter = createObjectMapper(true, false, new TimeToLiveDTOPersistenceSerializer());
        if (startScheduler) {
            this.scheduler = Executors.newSingleThreadScheduledExecutor(backupThreadFactory());
            this.scheduler.execute(this::writeBackupSafely);
            this.scheduler.scheduleAtFixedRate(this::writeBackupSafely, millisUntilNextUtcMidnight(clock), TimeUnit.DAYS.toMillis(1), TimeUnit.MILLISECONDS);
        } else {
            this.scheduler = null;
        }
    }

    private static ThreadFactory backupThreadFactory() {
        return runnable -> {
            Thread thread = new Thread(runnable, "MockServer-ExpectationDailyBackup-" + THREAD_INDEX.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        };
    }

    static long millisUntilNextUtcMidnight(Clock clock) {
        ZonedDateTime now = ZonedDateTime.now(clock.withZone(ZoneOffset.UTC));
        ZonedDateTime nextMidnight = now.toLocalDate().plusDays(1).atStartOfDay(ZoneOffset.UTC);
        return Math.max(Duration.between(now, nextMidnight).toMillis(), 0L);
    }

    private Path backupFileFor(LocalDate date) {
        return directory.resolve("expectation-" + date.format(FILE_DATE) + ".json");
    }

    void writeBackup() throws IOException {
        if (directory == null) {
            return;
        }
        List<Expectation> expectations = requestMatchers.retrieveActiveExpectations(null);
        Path file = backupFileFor(LocalDate.now(clock.withZone(ZoneOffset.UTC)));
        FileCreator.writeToFileAtomically("daily expectation backup", file.toFile(), serialize(expectations), false);
        if (mockServerLogger != null && mockServerLogger.isEnabledForInstance(INFO)) {
            mockServerLogger.logEvent(
                new LogEntry()
                    .setLogLevel(INFO)
                    .setMessageFormat("wrote daily expectation backup to{}")
                    .setArguments(file)
            );
        }
    }

    private void writeBackupSafely() {
        try {
            writeBackup();
        } catch (Throwable throwable) {
            if (mockServerLogger != null) {
                mockServerLogger.logEvent(
                    new LogEntry()
                        .setLogLevel(ERROR)
                        .setMessageFormat("exception writing daily expectation backup to " + directory)
                        .setThrowable(throwable)
                );
            }
        }
    }

    private String serialize(List<Expectation> expectations) {
        try {
            if (expectations != null && !expectations.isEmpty()) {
                ExpectationDTO[] expectationDTOs = new ExpectationDTO[expectations.size()];
                for (int i = 0; i < expectations.size(); i++) {
                    expectationDTOs[i] = new ExpectationDTO(expectations.get(i));
                }
                return objectWriter.writeValueAsString(expectationDTOs);
            }
            return "[]";
        } catch (Exception exception) {
            String description = SerializationFailure.describe(expectations != null ? expectations.toArray(new Expectation[0]) : null, exception);
            throw new RuntimeException("Exception while serializing expectation to JSON (" + description + ")", exception);
        }
    }

    public void stop() {
        if (scheduler != null) {
            scheduler.shutdownNow();
        }
    }
}
