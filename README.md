# prototype

My prototype for my Master's Thesis

## Get Started

You will need to have Docker and docker-compose installed in order to run the application.

### First Time Setup / Restoring the local database

Execute the following commands individually. This restores any potential data saved in the container.

```
docker compose down
rm -rf $HOME/neo4j/data
rm -rf $HOME/neo4j_empty/data
docker compose --profile restore run --rm neo4j-restore
```

### Running the Application and All Components

```
docker compose up
```
